import "dotenv/config";
import {Fireblocks, FireblocksResponse, TransactionResponse, TransactionStateEnum} from "@fireblocks/ts-sdk";
import { readFileSync } from "fs";

interface SetupResponse {
    address: string;
    fireblocks: Fireblocks;
    assetID: string;
}

/**
 * Retrieves the delegator address from Fireblocks vault.
 * @returns {Promise<SetupResponse>} - Address information.
 * @throws {Error} If no address is found.
 */
export const getFireblocksInformation = async (): Promise<SetupResponse> => {
    if (!process.env.FIREBLOCKS_API_KEY || !process.env.FIREBLOCKS_SECRET_KEY || !process.env.FIREBLOCKS_VAULT_ACCOUNT_ID) {
        throw new Error("Fireblocks environment variables not set properly.");
    }

    const assetID = "WND";
    const fireblocks = new Fireblocks({
        apiKey: process.env.FIREBLOCKS_API_KEY,
        basePath: process.env.FIREBLOCKS_BASE_PATH,
        secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
    });

    const vaultAccounts = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID,
        assetId: assetID,
    });

    const delegatorAddress = vaultAccounts.data?.addresses?.[0]?.address;
    if (!delegatorAddress) {
        throw new Error("No address found in Fireblocks vault for asset WND.");
    }

    return { address: delegatorAddress, fireblocks, assetID };
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