import "dotenv/config";
import {getFireblocksInformation, getFireblocksSignature} from "./fireblocks";
import {
    BondExtraResponse,
    DeriveTransactionResponse,
    fetchBondExtraTransaction,
    fetchUnsignedTransaction,
    prepareTransaction,
    StakeIntentResponse
} from "./api";
import {compileAndSend} from "./api";
import {CompileAndSendResponse} from "./api";


function checkRequiredEnvVars() {
    const requiredVars = [
        'BLOCKDAEMON_STAKE_API_KEY', 'POLKADOT_NETWORK', 'FIREBLOCKS_BASE_PATH',
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
    const network = process.env.POLKADOT_NETWORK?.toLowerCase();
    const isTestnet = network === 'westend';

    return {
        assetID: isTestnet ? "WND" : "DOT",
        stakeApiUrl: isTestnet
            ? 'https://svc.blockdaemon.com/boss/v1/polkadot/westend/bond-extra'
            : 'https://svc.blockdaemon.com/boss/v1/polkadot/mainnet/bond-extra',
        compileAndSendUrl: isTestnet
            ? 'https://svc.blockdaemon.com/tx/v1/polkadot-westend/compile_and_send'
            : 'https://svc.blockdaemon.com/tx/v1/polkadot-mainnet/compile_and_send',
        deriveApiUrl: isTestnet
            ? 'https://svc.blockdaemon.com/tx/v1/polkadot-westend/derive_signing_payload'
            : 'https://svc.blockdaemon.com/tx/v1/polkadot-mainnet/derive_signing_payload'
    };
}

async function main() {
    checkRequiredEnvVars()
    const config = getConfigForNetwork()

    const {address: sender, fireblocks} = await getFireblocksInformation(config.assetID);
    const amount = "1000000000000" //This is 1 DOT & the minimum

    //Call the Staking API to get your unsigned transaction
    const apiResponse: BondExtraResponse = await fetchBondExtraTransaction(sender, amount);
    console.log("Blockdaemon Staking API Response::", apiResponse);

    //Call our tx lifecycle API to derive the payload to send to fireblocks
    const deriveTransactionResponse: DeriveTransactionResponse = await prepareTransaction(apiResponse.polkadot.unsigned_transaction, apiResponse.polkadot.customer_address, config.deriveApiUrl)

    //Call and sign the transaction in fireblocks
    const {signature, pubKey} = await getFireblocksSignature(
        fireblocks,
        process.env.FIREBLOCKS_VAULT_ACCOUNT_ID!,
        "WND",
        deriveTransactionResponse.signing_payload
    );

    //Take the signature, pubkey and unsigned transaction and broadcast to the network
    await compileAndSend(deriveTransactionResponse.unsigned_tx, signature, pubKey, config.compileAndSendUrl);
}

main().catch(console.error);
