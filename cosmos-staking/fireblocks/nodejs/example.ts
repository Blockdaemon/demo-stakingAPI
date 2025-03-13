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
import { fromHex, toBase64 } from '@cosmjs/encoding';

// Define types for better type checking and readability
export type NewStakeIntentCosmos = {
    public_key: PublicKey
    amount: string
    delegator_address: string
}

export type NewStakeIntentResponse = {
    cosmos: {
        amount: string
        delegator_address: string
        hex_transaction: transaction
        unsigned_transaction: string
        validator_address: string
    }
    network: string
    protocol: string
    stake_intent_id: string
    customer_id: string
}

type transaction = {
    transaction_hash: string,
    unsigned_transaction_hex: string
}

type PublicKey = {
    type: string
    value: string
}

type AccountInformation = {
    address: string,
    pub_key: {
        '@type': string,
        key: string
    },
    account_number: string,
    sequence: string
}

// Check if all required environment variables are set
function checkRequiredEnvVars() {
    const requiredVars = [
        'BLOCKDAEMON_STAKE_API_KEY', 'FIREBLOCKS_BASE_PATH',
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
    return {
        assetID: "ATOM_COS",
        stakeApiUrl: 'https://svc.blockdaemon.com/boss/v1/cosmos/mainnet/stake-intents',
        cosmosAccountApiUrl: 'https://svc.blockdaemon.com/cosmos/mainnet/native/cosmos-rest/cosmos/auth/v1beta1/accounts',
        compileAndSendUrl: 'https://svc.blockdaemon.com/tx/v1/cosmos-mainnet/compile_and_send'
    };
}

async function main() {
    checkRequiredEnvVars();  // Check for required environment variables
    const config = getConfigForNetwork();

    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY!, "utf8"),
    });

    // Fetch the Cosmos vault account address from Fireblocks
    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!,
        assetId: config.assetID
    });
    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error(`Cosmos address not found (vault id: ${process.env.FIREBLOCKS_VAULT_ACCOUNT_ID})`);
    }
    console.log(`Cosmos address: ${delegatorAddress}\n`);

    // Query RPC to get public key address for request and sequence
    const accountInformation = await getAccountInformation(config.cosmosAccountApiUrl, delegatorAddress)
    console.log('Sequence:', accountInformation.sequence);

    // Create a stake intent with the Blockdaemon API for Cosmos
    const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY!, {
        public_key: {
            type: 'secp256k1',
            value: accountInformation.pub_key.key
        },
        amount: "1000000", //Minimum amount
        delegator_address: delegatorAddress
    }, config.stakeApiUrl);

    // Check if Cosmos-specific property exists
    if (!response.cosmos) {
        throw "Missing property `cosmos` in Blockdaemon response";
    }

    console.log(response)

    // Sign the transaction via Fireblocks
    const signedMessage = await signTx(response.cosmos.hex_transaction.unsigned_transaction_hex, response.cosmos.hex_transaction.transaction_hash, fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!, config.assetID);
    if (!signedMessage) {
        throw new Error('Failed to sign transaction');
    }

    const hexSignature = fromHex(signedMessage.signature)
    const base64Signature = toBase64(hexSignature)

    await broadcastSignedTransaction(response.cosmos.unsigned_transaction, base64Signature, accountInformation.pub_key.key, parseInt(accountInformation.sequence), config.compileAndSendUrl);
}

// Function for creating a stake intent with the Blockdaemon API for Cosmos
async function createStakeIntent(
    bossApiKey: string,
    request: NewStakeIntentCosmos,
    stakeApiUrl: string
): Promise<NewStakeIntentResponse> {
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
    return await response.json() as NewStakeIntentResponse;
}

// Function to sign the transaction via Fireblocks
const signTx = async (
    unsignedHex: string,
    transactionHex: string,
    fireblocks: Fireblocks,
    vaultAccount: string,
    assetID: string,
): Promise<{ signature: string; pubKey: string }> => {

    console.log('transactionHex', transactionHex)
    console.log('unsignedHex', unsignedHex)

    // Fireblocks signing payload
    const transactionPayload: TransactionRequest = {
        assetId: assetID,
        operation: TransactionOperation.Raw,
        source: {
            type: TransferPeerPathType.VaultAccount,
            id: vaultAccount,
        },
        extraParameters: {
            rawMessageData: {
                // Send the hash and preHash content
                messages: [
                    {
                        content: transactionHex,
                        preHash: {
                            content: unsignedHex,
                            hashAlgorithm: "SHA256",
                        },
                    },
                ],
            },
        },
    };

    const transactionResponse: FireblocksResponse<CreateTransactionResponse> =
        await fireblocks.transactions.createTransaction({
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
async function broadcastSignedTransaction(unsignedTx: string, signature: string, publicKeyHex: string, sequence: number, compileAndSendUrl: string) {

    const requestBody = JSON.stringify({
        signatures: [{
            sequence: sequence,
            sign_mode: 1,
            signature: signature,
            public_key: publicKeyHex
        }],
        unsigned_tx: unsignedTx,
    });

    console.log('Request body:', requestBody);

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

// Function to get account information from Blockdaemon API
async function getAccountInformation(url: string, address: string): Promise<AccountInformation> {
    const requestOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.BLOCKDAEMON_API_KEY}`,
        },
    };

    const mergedUrl = `${url}/${address}`

    const response = await fetch(mergedUrl, requestOptions);
    const responseData = await response.json();
    if (response.status !== 200) {
        throw new Error(`Error: ${JSON.stringify(responseData)}`);
    }

    console.log('Get Account information:', responseData);
    return responseData.account;
}

// Execute the main function
main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
