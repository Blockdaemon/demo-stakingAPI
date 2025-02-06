import "dotenv/config";
import {ApiPromise, WsProvider} from "@polkadot/api";
import {
    Fireblocks,
} from "@fireblocks/ts-sdk";
import {SubmittableExtrinsic} from "@polkadot/api/promise/types";
import {getFireblocksInformation} from "./fireblocks";
import {createFireblocksSigner} from "./signer";
import {fetchUnsignedTransaction, StakeIntentResponse} from "./api";


async function decodeUnsignedTransaction(api: ApiPromise, unsignedTxHex: string): Promise<SubmittableExtrinsic> {
    // 🔹 Decode the transaction into an Extrinsic
    const extrinsic = api.tx(unsignedTxHex)
    console.log('Decoded Transaction:', extrinsic.toHuman());
    return extrinsic;
}

async function submitTransaction(api: ApiPromise, sender: string, unsignedTxHex: string, fireblocks: Fireblocks, vaultAccountId: string, assetID: string) {
    console.log("Preparing transaction...");
    const tx = await decodeUnsignedTransaction(api, unsignedTxHex);
    console.log("Decoded Transaction:", tx.method.toHuman());

    const signer = createFireblocksSigner(fireblocks, vaultAccountId, assetID);

    return new Promise<void>((resolve, reject) => {
        tx.signAndSend(sender, { signer }, (result) => {
            if (result.status.isInBlock) {
                console.log(`Transaction included in block: ${result.status.asInBlock.toHex()}`);
            } else if (result.status.isFinalized) {
                console.log(`Transaction finalized: ${result.status.asFinalized.toHex()}`);
                resolve();
            } else if (result.dispatchError) {
                console.error("Transaction failed:", result.dispatchError.toString());
                reject(new Error("Transaction failed"));
            }
        });
    });
}

async function main() {
    try {
        const { address: sender, fireblocks, assetID } = await getFireblocksInformation();

        console.log("Fetching unsigned transaction from Blockdaemon...");
        const apiResponse: StakeIntentResponse = await fetchUnsignedTransaction(sender);

        console.log("Blockdaemon Response:", apiResponse);

        const unsignedTxHex = apiResponse.polkadot.unsigned_transaction;

        const wsProvider = new WsProvider("wss://westend-rpc.polkadot.io");
        const api = await ApiPromise.create({ provider: wsProvider });

        console.log("Connected to Polkadot node.");

        await submitTransaction(api, sender, unsignedTxHex, fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!, assetID);

        await wsProvider.disconnect();
    } catch (error) {
        console.error("Error:", error);
    }
}

main().catch(console.error);
