import {readFileSync} from 'fs';
import 'dotenv/config';
import {
    Fireblocks,
    FireblocksResponse,
    TransferPeerPathType,
    TransactionRequest,
    TransactionResponse,
    TransactionOperation,
    TransactionStateEnum,
    CreateTransactionResponse, SignedMessage
} from "@fireblocks/ts-sdk";
import { sha256 } from '@noble/hashes/sha256'


import {connect, transactions, utils} from "near-api-js";

// Define the types for Near Stake Intent
export type NewStakeIntentNear = {
    wallet_address: string;
    public_key: string;
    to: string;
    amount: string
};

async function main() {

    // Check for the required environment variables
    if (!process.env.BLOCKDAEMON_STAKE_API_KEY) {
        throw new Error('BLOCKDAEMON_STAKE_API_KEY environment variable not set');
    }

    if (!process.env.NEAR_NETWORK) {
        throw new Error('NEAR_NETWORK environment variable not set.');
    }

    if (!process.env.FIREBLOCKS_BASE_PATH) {
        throw new Error('FIREBLOCKS_BASE_PATH environment variable not set');
    }

    if (!process.env.FIREBLOCKS_API_KEY) {
        throw new Error('FIREBLOCKS_API_KEY environment variable not set');
    }

    if (!process.env.FIREBLOCKS_SECRET_KEY) {
        throw new Error('FIREBLOCKS_SECRET_KEY environment variable not set');
    }

    if (!process.env.FIREBLOCKS_VAULT_ACCOUNT_ID) {
        throw new Error('FIREBLOCKS_VAULT_ACCOUNT_ID environment variable not set');
    }

    // Determine Fireblocks Asset ID for Near
    const assetID = "NEAR_TEST";  // Use "NEAR" for mainnet

    // Create a Fireblocks API instance
    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
    });

    // Fetch the Near vault account address from Fireblocks
    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID,
        assetId: assetID
    });
    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error(`Near address not found (vault id: ${process.env.FIREBLOCKS_VAULT_ACCOUNT_ID})`);
    }
    console.log(`Near address: ${delegatorAddress}\n`);

    // Create a stake intent with the Blockdaemon API for Near
    const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY, {
        wallet_address: delegatorAddress,
        public_key: "ADD-PUBLIC-KEY", // https://nearvalidate.org/address/ will show you the public key of your address
        amount: "1000000000000000000000000", //In Yocto
        to: "colossus.pool.f863973.m0" //validator pool
    });


    // Check if Near-specific property exists
    if (!response.near) {
        throw "Missing property `near` in Blockdaemon response";
    }

    console.log(response)

    // // Sign the transaction via Fireblocks
    const signedMessage = await signTx(response.near.unsigned_transaction, fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID, assetID);
    if (!signedMessage) {
        throw new Error('Failed to sign transaction');
    }

    const broadcast = await broadcastSignedTransaction(response.near.unsigned_transaction, signedMessage.signature, signedMessage.pubKey)
    console.log(broadcast)

}

// Function for creating a stake intent with the Blockdaemon API for Near
async function createStakeIntent(
    bossApiKey: string,
    request: NewStakeIntentNear,
): Promise<any> {
    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': bossApiKey,
        },
        body: JSON.stringify(request),
    };

    const response = await fetch(
        `https://svc.blockdaemon.com/boss/v1/near/${process.env.NEAR_NETWORK}/stake-intents`,
        requestOptions
    );
    if (response.status != 200) {
        throw await response.json();
    }
    return await response.json();
}

// Function to sign the transaction via Fireblocks
const signTx = async (
    unsignedTransaction: string,
    fireblocks: Fireblocks,
    vaultAccount: string,
    assetID: string,
): Promise<{ signature: string; pubKey: string }> => {
    // 🔹 Compute the transaction hash BEFORE sending to Fireblocks
    const unsignedTxBytes = Buffer.from(unsignedTransaction, "hex");
    const transactionHash = sha256(unsignedTxBytes);
    const messageToSign = Buffer.from(transactionHash).toString("hex");
    console.log("Transaction Hash Sent to Fireblocks:", messageToSign);

    const transactionPayload: TransactionRequest = {
        assetId: assetID,
        operation: TransactionOperation.Raw,
        source: {
            type: TransferPeerPathType.VaultAccount,
            id: vaultAccount,
        },
        note: '',
        extraParameters: {
            rawMessageData: {
                messages: [
                    { content: messageToSign }, // 🔥 Send the hashed transaction instead
                ],
            },
        },
    };

    try {
        // 🔹 Step 2: Sign the transaction using Fireblocks
        const transactionResponse: FireblocksResponse<CreateTransactionResponse> = await fireblocks.transactions.createTransaction({
            transactionRequest: transactionPayload,
        });

        const txId = transactionResponse.data.id;
        if (!txId) throw new Error("Transaction ID is undefined.");

        // 🔹 Step 3: Wait for transaction completion and get the signed message
        const txInfo = await getTxStatus(txId, fireblocks);
        console.log("Fireblocks Response:", JSON.stringify(txInfo, null, 2));

        // 🔹 Step 4: Extract signature and verify public key
        const signature = txInfo.signedMessages?.[0]?.signature?.fullSig;
        const pubKey = txInfo.signedMessages?.[0].publicKey!;
        if (!signature) throw new Error("Missing signature");

        console.log("Fireblocks Signed Public Key:", pubKey);
        console.log("Fireblocks Signature:", signature);

        return { signature, pubKey };
    } catch (error) {
        console.error("Error signing transaction:", error);
        throw error;
    }
};


// Helper function to get the transaction status from Fireblocks
const getTxStatus = async (
    txId: string,
    fireblocks: Fireblocks): Promise<TransactionResponse> => {
    try {
        let response: FireblocksResponse<TransactionResponse> =
            await fireblocks.transactions.getTransaction({txId});
        let tx: TransactionResponse = response.data;
        let messageToConsole: string = `Transaction ${tx.id} is currently at status - ${tx.status}`;

        console.log(messageToConsole);
        while (tx.status !== TransactionStateEnum.Completed) {
            await new Promise((resolve) => setTimeout(resolve, 3000));

            response = await fireblocks.transactions.getTransaction({txId});
            tx = response.data;

            switch (tx.status) {
                case TransactionStateEnum.Blocked:
                case TransactionStateEnum.Cancelled:
                case TransactionStateEnum.Failed:
                case TransactionStateEnum.Rejected:
                    throw new Error(
                        `Signing request failed/blocked/cancelled: Transaction: ${tx.id} status is ${tx.status}`,
                    );
                default:
                    console.log(messageToConsole);
                    break;
            }
        }
        return tx;
    } catch (error) {
        throw error;
    }
};


async function broadcastSignedTransaction(unsignedTx: string, signatureHex: string, signedPublicKey: string) {
    try {
        console.log("Connecting to NEAR Testnet RPC...");
        const near = await connect({
            networkId: "testnet",
            nodeUrl: "https://rpc.testnet.near.org",
        });

        console.log("Decoding unsigned transaction from hex...");
        const unsignedTransaction = transactions.Transaction.decode(Buffer.from(unsignedTx, 'hex'));
        console.log("Decoded unsigned transaction:", unsignedTransaction);

        // 🔹 Step 1: Convert the Fireblocks signature from hex to a buffer
        const signatureBuffer = Buffer.from(signatureHex, "hex");
        console.log("Signature Buffer:", signatureBuffer);
        console.log("Signature Length:", signatureBuffer.length);

        if (signatureBuffer.length !== 64) {
            throw new Error("Invalid signature length: Ed25519 signatures must be exactly 64 bytes.");
        }

        // 🔹 Step 2: Validate the Signed Public Key Matches Transaction
        const transactionPublicKey = Buffer.from(unsignedTransaction.publicKey?.ed25519Key!.data).toString("hex");
        console.log("Unsigned Transaction Public Key:", transactionPublicKey);
        console.log("Fireblocks Signed Public Key:", signedPublicKey);

        if (transactionPublicKey !== signedPublicKey) {
            throw new Error("Public key mismatch! Fireblocks signed with a different key.");
        }

        // 🔹 Step 3: Construct the SignedTransaction
        console.log("Creating signed transaction...");
        const signedTransaction = new transactions.SignedTransaction({
            transaction: unsignedTransaction,
            signature: new transactions.Signature({
                keyType: 0, // Ed25519 key type
                data: signatureBuffer,
            }),
        });
        console.log("Signed transaction constructed:", signedTransaction);

        // 🔹 Step 4: Submit the Signed Transaction to NEAR
        console.log("Sending transaction using NEAR connection provider...");
        const provider = near.connection.provider;
        const result = await provider.sendTransaction(signedTransaction);
        console.log("Transaction Result:", result);

        return result;
    } catch (error) {
        console.error("Error broadcasting transaction:", error);
        throw error;
    }
}


main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
