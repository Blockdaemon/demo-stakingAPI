import { readFileSync } from 'fs';
import 'dotenv/config';
import {
    Fireblocks,
    FireblocksResponse,
    TransferPeerPathType,
    TransactionRequest,
    TransactionResponse,
    TransactionOperation,
    TransactionStateEnum,
    CreateTransactionResponse
} from "@fireblocks/ts-sdk";

// Define the types for Near Stake Intent
export type NewStakeIntentNear = {
    wallet_address: string;
    public_key: string;
    to: string;
    amount: string
};

// Check if all required environment variables are set
function checkRequiredEnvVars() {
    const requiredVars = [
        'BLOCKDAEMON_STAKE_API_KEY', 'NEAR_NETWORK', 'FIREBLOCKS_BASE_PATH',
        'FIREBLOCKS_API_KEY', 'FIREBLOCKS_SECRET_KEY', 'FIREBLOCKS_VAULT_ACCOUNT_ID', 'BLOCKDAEMON_API_KEY'
    ];

    requiredVars.forEach(varName => {
        if (!process.env[varName]) {
            throw new Error(`${varName} environment variable not set`);
        }
    });
}

// Determine the configuration for mainnet or testnet
function getConfigForNetwork() {
    const network = process.env.NEAR_NETWORK?.toLowerCase();
    const isTestnet = network === 'testnet';

    return {
        assetID: isTestnet ? "NEAR_TEST" : "NEAR",  // NEAR_TEST for testnet, NEAR for mainnet
        stakeApiUrl: isTestnet
            ? 'https://svc.blockdaemon.com/boss/v1/near/testnet/stake-intents'
            : 'https://svc.blockdaemon.com/boss/v1/near/mainnet/stake-intents',
        compileAndSendUrl: isTestnet
            ? 'https://svc.blockdaemon.com/tx/v1/near-testnet/compile_and_send'
            : 'https://svc.blockdaemon.com/tx/v1/near-mainnet/compile_and_send'
    };
}

async function main() {
    checkRequiredEnvVars();  // Check for required environment variables
    const config = getConfigForNetwork();  // Get config based on mainnet or testnet

    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY!, "utf8"),
    });

    // Fetch the Near vault account address from Fireblocks
    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!,
        assetId: config.assetID
    });
    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error(`Near address not found (vault id: ${process.env.FIREBLOCKS_VAULT_ACCOUNT_ID})`);
    }
    console.log(`Near address: ${delegatorAddress}\n`);

    // Create a stake intent with the Blockdaemon API for Near
    const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY!, {
        wallet_address: delegatorAddress,
        public_key: "ed25519:97ZPzFy8L4QWG7BVk9Ca94qMKrUXjrYZUD3vNCnRrsur",  // Example public key
        amount: "1000000000000000000000000",  // In Yocto
        to: "colossus.pool.f863973.m0"  // Validator pool
    }, config.stakeApiUrl);

    // Check if Near-specific property exists
    if (!response.near) {
        throw "Missing property `near` in Blockdaemon response";
    }

    // Sign the transaction via Fireblocks
    const signedMessage = await signTx(response.near.unsigned_transaction_hash, fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!, config.assetID);
    if (!signedMessage) {
        throw new Error('Failed to sign transaction');
    }

    const encodedUnsignedMessage = await hexToBase64(response.near.unsigned_transaction)

    await broadcastSignedTransaction(encodedUnsignedMessage, signedMessage.signature, config.compileAndSendUrl);
}

// Decode and encode the unsigned transaction to Base64
async function hexToBase64(unsignedTxHex: string): Promise<string> {
    const unsignedTxBuffer = Buffer.from(unsignedTxHex, 'hex');
    return unsignedTxBuffer.toString('base64');
}

// Function for creating a stake intent with the Blockdaemon API for Near
async function createStakeIntent(
    bossApiKey: string,
    request: NewStakeIntentNear,
    stakeApiUrl: string
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

    const response = await fetch(stakeApiUrl, requestOptions);
    if (response.status !== 200) {
        throw await response.json();
    }
    return await response.json();
}

// Function to sign the transaction via Fireblocks
const signTx = async (
    unsignedTransactionHash: string,
    fireblocks: Fireblocks,
    vaultAccount: string,
    assetID: string,
): Promise<{ signature: string; pubKey: string }> => {
    const transactionPayload: TransactionRequest = {
        assetId: assetID,
        operation: TransactionOperation.Raw,
        source: {
            type: TransferPeerPathType.VaultAccount,
            id: vaultAccount,
        },
        extraParameters: {
            rawMessageData: {
                messages: [{ content: unsignedTransactionHash }],
            },
        },
    };

    const transactionResponse: FireblocksResponse<CreateTransactionResponse> = await fireblocks.transactions.createTransaction({
        transactionRequest: transactionPayload,
    });

    const txId = transactionResponse.data.id;
    if (!txId) throw new Error("Transaction ID is undefined.");

    const txInfo = await getTxStatus(txId, fireblocks);

    const signature = txInfo.signedMessages?.[0]?.signature?.fullSig;
    const pubKey = txInfo.signedMessages?.[0].publicKey!;
    if (!signature) throw new Error("Missing signature");

    return { signature, pubKey };
};

// Helper function to get the transaction status from Fireblocks
const getTxStatus = async (
    txId: string,
    fireblocks: Fireblocks): Promise<TransactionResponse> => {
    let response: FireblocksResponse<TransactionResponse> = await fireblocks.transactions.getTransaction({ txId });
    let tx: TransactionResponse = response.data;
    while (tx.status !== TransactionStateEnum.Completed) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        response = await fireblocks.transactions.getTransaction({ txId });
        tx = response.data;
    }
    return tx;
};

// Broadcast signed transaction
async function broadcastSignedTransaction(unsignedTxEncoded: string, signature: string, compileAndSendUrl: string) {
    const requestBody = JSON.stringify({
        signature: signature,
        unsigned_tx: unsignedTxEncoded,
    });

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.BLOCKDAEMON_API_KEY}`,
        },
        body: requestBody,
    };

    const response = await fetch(compileAndSendUrl, requestOptions);
    const responseData = await response.json();
    if (response.status !== 200) {
        throw new Error(`Error: ${JSON.stringify(responseData)}`);
    }

    console.log('Transaction sent successfully:', responseData);
    return responseData;
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
