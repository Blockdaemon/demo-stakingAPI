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
import {
    Ed25519Signature, hash_transaction, PublicKey,
    Transaction,
    TransactionBody,
    TransactionWitnessSet, Vkey, Vkeywitness,
    Vkeywitnesses
} from "@emurgo/cardano-serialization-lib-nodejs";

// Define the types for Cardano Stake Intent
export type NewStakeIntentCardano = {
    base_address: string;
    plan_id: string;
};

export type SubmitTransaction = {
    customer_id: string;
    network: string;
    protocol: string;
    transaction_id: string;
}

async function main() {

    // Check for the required environment variables
    if (!process.env.BLOCKDAEMON_STAKE_API_KEY) {
        throw new Error('BLOCKDAEMON_STAKE_API_KEY environment variable not set');
    }

    if (!process.env.PLAN_ID) {
        throw new Error('PLAN_ID environment variable not set');
    }

    if (!process.env.CARDANO_NETWORK) {
        throw new Error('CARDANO_NETWORK environment variable not set.');
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

    // Determine Fireblocks Asset ID for Cardano
    const assetID = "ADA_TEST";  // Use "ADA" for mainnet

    // Create a Fireblocks API instance
    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
    });

    // Fetch the Cardano vault account address from Fireblocks
    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID,
        assetId: assetID
    });
    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error(`Cardano address not found (vault id: ${process.env.FIREBLOCKS_VAULT_ACCOUNT_ID})`);
    }
    console.log(`Cardano address: ${delegatorAddress}\n`);

    // Create a stake intent with the Blockdaemon API for Cardano
    const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY, {
        base_address: delegatorAddress,
        plan_id: process.env.PLAN_ID ?? ""
    });

    // Check if Cardano-specific property exists
    if (!response.cardano) {
        throw "Missing property `cardano` in Blockdaemon response";
    }

    // Get the unsigned transaction data returned by the Staking Integration API
    const unsignedTransactionHex = response.cardano.unsigned_transaction;
    const unsignedTransactionBody = decodeUnsignedTransactionBody(unsignedTransactionHex);

    // **Hash the transaction body**
    const txHash = hash_transaction(unsignedTransactionBody).to_hex();
    console.log(`Transaction Hash: ${txHash}`);

    // // Sign the transaction via Fireblocks
    const signedMessages = await signTx(txHash, fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID, assetID);
    if (!signedMessages) {
        throw new Error('Failed to sign transaction');
    }

// Now we create the signed transaction with both signatures
    const signedTransaction = createSignedTransaction(unsignedTransactionBody, signedMessages);
    console.log(`Signed transaction (CBOR): ${Buffer.from(signedTransaction).toString('hex')}`);

    const broadcastTransaction = await submitTransaction(process.env.BLOCKDAEMON_STAKE_API_KEY, Buffer.from(signedTransaction).toString('hex'))
    console.log(`Submitted transaction: ${broadcastTransaction.transaction_id}`)
    // The transaction ID logged above can be queried on the explorer.
}

// Function for creating a stake intent with the Blockdaemon API for Cardano
async function createStakeIntent(
    bossApiKey: string,
    request: NewStakeIntentCardano,
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
        `https://svc.blockdaemon.com/boss/v1/cardano/${process.env.CARDANO_NETWORK}/stake-intents`,
        requestOptions
    );
    if (response.status != 200) {
        throw await response.json();
    }
    return await response.json();
}

async function submitTransaction(
    bossApiKey: string,
    signed_transaction: string,
): Promise<SubmitTransaction> {
    const body = {
        "signed_transaction": signed_transaction
    }
    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': bossApiKey,
        },
        body: JSON.stringify(body),
    };
    const response = await fetch(
        `https://svc.blockdaemon.com/boss/v1/cardano/${process.env.CARDANO_NETWORK}/transaction-submission`,
        requestOptions
    );
    if (response.status != 200) {
        throw await response.json();
    }
    return await response.json() as SubmitTransaction;
}

// Function to sign the transaction via Fireblocks
const signTx = async (
    unsignedTransaction: string,
    fireblocks: Fireblocks,
    vaultAccount: string,
    assetID: string,
): Promise<{ publicKey: string; signature: string }[] | undefined> => {
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
                    {
                        content: unsignedTransaction // The unsigned transaction in hex format
                    },
                    {
                        content: unsignedTransaction,
                        bip44change: 2
                    },
                ],
            },
        },
    };

    try {
        // Create the transaction and get response
        const transactionResponse: FireblocksResponse<CreateTransactionResponse> = await fireblocks.transactions.createTransaction({
            transactionRequest: transactionPayload,
        });

        const txId = transactionResponse.data.id;
        if (!txId) {
            throw new Error("Transaction ID is undefined.");
        }

        // Wait for transaction completion and get full tx info with signed messages
        const txInfo = await getTxStatus(txId, fireblocks);

        console.log(JSON.stringify(txInfo, null, 2));

        // Map over signedMessages to extract the publicKey and signature
        return txInfo.signedMessages?.map((msg: SignedMessage) => ({
            publicKey: msg.publicKey as string,
            signature: msg.signature?.fullSig as string,
        }));
    } catch (error) {
        console.error("Error signing transaction:", error);
        return undefined;
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

const decodeUnsignedTransactionBody = (unsignedTransactionHex: string): TransactionBody => {
    const unsignedTransactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');
    return TransactionBody.from_bytes(unsignedTransactionBuffer);
}

// Function to create the signed transaction with the signatures and public keys
const createSignedTransaction = (unsignedTxBody: TransactionBody, signedMessages: {
    publicKey: string,
    signature: string
}[]): Uint8Array => {
    const witnessSet = TransactionWitnessSet.new();
    const vkeyWitnesses = Vkeywitnesses.new();

    signedMessages.forEach(({publicKey, signature}) => {
        const vkeyWitness = Vkeywitness.new(
            Vkey.new(PublicKey.from_bytes(Buffer.from(publicKey, 'hex'))),
            Ed25519Signature.from_bytes(Buffer.from(signature, 'hex'))
        );
        vkeyWitnesses.add(vkeyWitness);
    });

    witnessSet.set_vkeys(vkeyWitnesses);
    const signedTransaction = Transaction.new(unsignedTxBody, witnessSet);

    return signedTransaction.to_bytes();
};

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
