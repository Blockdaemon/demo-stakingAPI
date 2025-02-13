import "dotenv/config";
import {
    CreateTransactionResponse,
    Fireblocks,
    FireblocksResponse,
    TransactionOperation,
    TransactionResponse,
    TransactionStateEnum, TransferPeerPathType
} from "@fireblocks/ts-sdk";
import { readFileSync } from "fs";

interface SetupResponse {
    address: string;
    fireblocks: Fireblocks;
}

/**
 * Retrieves the delegator address from Fireblocks vault.
 * @returns {Promise<SetupResponse>} - Address information.
 * @throws {Error} If no address is found.
 */
export const getFireblocksInformation = async (assetId: string): Promise<SetupResponse> => {
    if (!process.env.FIREBLOCKS_API_KEY || !process.env.FIREBLOCKS_SECRET_KEY || !process.env.FIREBLOCKS_VAULT_ACCOUNT_ID) {
        throw new Error("Fireblocks environment variables not set properly.");
    }

    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
    });

    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID,
        assetId: assetId,
    });

    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error("No address found in Fireblocks vault for asset WND.");
    }

    return { address: delegatorAddress, fireblocks };
};

/**
 * Example usage:
 *
 * (async () => {
 *     try {
 *         const data = await getFireblocksDelegatorAddress();
 *         console.log("Fireblocks Address:", data.address);
 *     } catch (error) {
 *         console.error("Error fetching Fireblocks address:", error.message);
 *     }
 * })();
 */


export const getTxStatus = async (
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


/**
 * Retrieves the signed message and public key from the Fireblocks vault.
 * This function sends a raw message for signing and waits for the transaction to be signed.
 *
 * @param {Fireblocks} fireblocks - The Fireblocks instance for interacting with the Fireblocks API.
 * @param {string} vaultAccountId - The ID of the vault account holding the asset.
 * @param {string} assetId - The ID of the asset to be used in the transaction.
 * @param {string} data - The raw message data to be signed.
 * @returns {Promise<{ signature: string; pubKey: string }>} - The signed message and public key.
 * @throws {Error} If the transaction ID is missing, the signature is missing, or any other error occurs during the signing process.
 */
export const getFireblocksSignature = async (
    fireblocks: Fireblocks,
    vaultAccountId: string,
    assetId: string,
    data: string
): Promise<{ signature: string; pubKey: string }> => {
    try {
        console.log("Signing payload with Fireblocks:", data);

        // Prepare the transaction payload for signing
        const transactionPayload = {
            assetId,
            operation: TransactionOperation.Raw,
            source: {
                type: TransferPeerPathType.VaultAccount,
                id: vaultAccountId,
            },
            extraParameters: {
                rawMessageData: {
                    messages: [{ content: data.substring(2) }], // Remove "0x" prefix if it exists
                },
            },
        };

        // Create the transaction on Fireblocks
        const response: FireblocksResponse<CreateTransactionResponse> =
            await fireblocks.transactions.createTransaction({
                transactionRequest: transactionPayload,
            });

        const txId = response.data.id;
        if (!txId) throw new Error("Transaction ID is undefined.");

        // Wait for Fireblocks to sign the transaction
        const signedTx = await getTxStatus(txId, fireblocks);

        // Extract the signature and public key
        const signature = signedTx.signedMessages?.[0]?.signature?.fullSig;
        const pubKey = signedTx.signedMessages?.[0].publicKey!;
        if (!signature) throw new Error("Missing signature");

        return { signature, pubKey };
    } catch (error) {
        console.error("Error signing with Fireblocks:", error);
        throw error;
    }
};
