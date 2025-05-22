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
    SignedMessage,
    CreateTransactionResponse
} from "@fireblocks/ts-sdk";
import { Algodv2, makeKeyRegistrationTxnWithSuggestedParamsFromObject, waitForConfirmation } from "algosdk";

async function main() {
    const requiredFields = [
        'ALGORAND_NETWORK',
        'FIREBLOCKS_BASE_PATH',
        'FIREBLOCKS_API_KEY',
        'FIREBLOCKS_SECRET_KEY',
        'FIREBLOCKS_VAULT_ACCOUNT_ID',
        'ALGORAND_VOTE_KEY',
        'ALGORAND_SELECTION_KEY',
        'ALGORAND_STATE_PROOF_KEY',
        'ALGORAND_VOTE_FIRST',
        'ALGORAND_VOTE_LAST',
        'ALGORAND_VOTE_KEY_DILUTION'
    ] as const;

    // Validate all fields exist
    for (const field of requiredFields) {
        if (!process.env[field]) {
            throw new Error(`Required environment variable '${field}' is not defined`);
        }
    }

    // After validation, we can safely assert the types
    const algorandNetwork = process.env.ALGORAND_NETWORK as string;
    const fireblocksBasePath = process.env.FIREBLOCKS_BASE_PATH as string;
    const fireblocksApiKey = process.env.FIREBLOCKS_API_KEY as string;
    const fireblocksSecretKey = process.env.FIREBLOCKS_SECRET_KEY as string;
    const fireblocksVaultAccountId = process.env.FIREBLOCKS_VAULT_ACCOUNT_ID as string;
    const voteKey = process.env.ALGORAND_VOTE_KEY as string;
    const selectionKey = process.env.ALGORAND_SELECTION_KEY as string;
    const stateProofKey = process.env.ALGORAND_STATE_PROOF_KEY as string;
    const voteFirst = parseInt(process.env.ALGORAND_VOTE_FIRST as string);
    const voteLast = parseInt(process.env.ALGORAND_VOTE_LAST as string);
    const voteKeyDilution = parseInt(process.env.ALGORAND_VOTE_KEY_DILUTION as string);

    // Now we can safely use the env values since they're validated
    const assetID = algorandNetwork === 'mainnet' ? "ALGO" : "ALGO_TEST";

    // Create a Fireblocks API instance with validated values
    const fireblocks = new Fireblocks({
        apiKey: fireblocksApiKey,
        basePath: fireblocksBasePath,
        secretKey: readFileSync(fireblocksSecretKey, "utf8"),
    });

    // Fetch the algorand vault account address from Fireblocks
    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: fireblocksVaultAccountId,
        assetId: assetID
    });
    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error(`Algorand address not found (vault id: ${fireblocksVaultAccountId})`);
    }
    console.log(`Algorand address: ${delegatorAddress}\n`);

    // Initialize Algorand client
    const algodToken = 'a'.repeat(64);
    const algodServer = algorandNetwork === 'mainnet' 
        ? 'https://mainnet-api.algonode.cloud'
        : 'https://testnet-api.algonode.cloud';
    const algodPort = 443;
    const algodClient = new Algodv2(algodToken, algodServer, algodPort);

    // Check account balance
    const acctInfo = await algodClient.accountInformation(delegatorAddress).do();
    console.log(`Account balance: ${acctInfo.amount} microAlgos`);

    // Create an online key registration transaction
    const suggestedParams = await algodClient.getTransactionParams().do();

    // create transaction
    const txn = makeKeyRegistrationTxnWithSuggestedParamsFromObject({
        sender: delegatorAddress,
        voteKey: Buffer.from(voteKey, 'base64'),
        selectionKey: Buffer.from(selectionKey, 'base64'),
        stateProofKey: Buffer.from(stateProofKey, 'base64'),
        voteFirst,
        voteLast,
        voteKeyDilution,
        suggestedParams: suggestedParams,
    });
    console.log("Unsigned Transaction details:", txn);
    console.log("Bytes to sign:", Buffer.from(txn.bytesToSign()).toString('hex'));

    // Sign the transaction via Fireblocks
    const signedMessages = await signTx(
        Buffer.from(txn.bytesToSign()).toString('hex'),
        fireblocks,
        fireblocksVaultAccountId,
        assetID
    );
    if (!signedMessages) {
        throw new Error('Failed to sign transaction');
    }
    console.log("Signature:", signedMessages[0].signature);

    // Create the signed transaction with both signatures
    const stxn = txn.attachSignature(delegatorAddress, Buffer.from(signedMessages[0].signature, 'hex'));

    // Broadcast signed transaction
    const tx = await algodClient.sendRawTransaction(stxn).do();
    const result = await waitForConfirmation(algodClient, tx.txid, 4);
    console.log('Broadcasted txn ID:', tx.txid);
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
                    }
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


main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
