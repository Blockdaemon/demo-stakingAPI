import { Signer, SignerResult } from "@polkadot/api/types";
import {
    CreateTransactionResponse,
    Fireblocks,
    FireblocksResponse,
    TransactionOperation,
    TransferPeerPathType,
} from "@fireblocks/ts-sdk";
import { SignerPayloadRaw } from "@polkadot/types/types";
import { getTxStatus } from "./fireblocks";

/**
 * Creates a function-based Fireblocks signer.
 * @param fireblocks - The Fireblocks SDK instance.
 * @param vaultAccountId - The vault account ID.
 * @param assetId - The asset ID.
 * @returns A signRaw function that can be used as a Polkadot signer.
 */
export const createFireblocksSigner = (
    fireblocks: Fireblocks,
    vaultAccountId: string,
    assetId: string
): Signer => ({
    /**
     * Signs raw data using Fireblocks.
     * @param param0 - The raw payload containing the data to sign.
     * @returns A promise resolving to the signature result.
     */
    signRaw: async ({ data }: SignerPayloadRaw): Promise<SignerResult> => {
        try {
            console.log("Signing payload with Fireblocks:", data);

            const transactionPayload = {
                assetId,
                operation: TransactionOperation.Raw,
                source: {
                    type: TransferPeerPathType.VaultAccount,
                    id: vaultAccountId,
                },
                extraParameters: {
                    rawMessageData: {
                        messages: [{ content: data.substring(2) }],
                    },
                },
            };

            const response: FireblocksResponse<CreateTransactionResponse> =
                await fireblocks.transactions.createTransaction({
                    transactionRequest: transactionPayload,
                });

            const txId = response.data.id;
            if (!txId) throw new Error("Transaction ID is undefined.");

            // Wait for Fireblocks to sign
            const signedTx = await getTxStatus(txId, fireblocks);

            const signature: `0x${string}` = `0x00${signedTx.signedMessages?.[0]?.signature?.fullSig}`;
            if (!signature) throw new Error("Missing Fireblocks signature.");

            console.log("Fireblocks Signature:", signature);

            return { id: 1, signature };
        } catch (error) {
            throw error;
        }
    },
});
