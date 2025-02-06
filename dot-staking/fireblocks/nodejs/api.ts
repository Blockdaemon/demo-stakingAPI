import "dotenv/config";
import fetch from "node-fetch";

export type StakeIntentResponse = {
    customer_id: string;
    network: string;
    polkadot: {
        customer_address: string;
        proxy_address: string;
        unsigned_transaction: string;
    };
    protocol: string;
    stake_intent_id: string;
};


export async function fetchUnsignedTransaction(delegatorAddress: string): Promise<StakeIntentResponse> {
    const response = await fetch(
        `https://svc.blockdaemon.com/boss/v1/polkadot/${process.env.DOT_NETWORK}/stake-intents`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-API-Key": process.env.BLOCKDAEMON_STAKE_API_KEY!,
            },
            body: JSON.stringify({ customer_address: delegatorAddress }),
        }
    );

    if (response.status !== 200) {
        throw new Error(`Blockdaemon API Error: ${JSON.stringify(await response.json())}`);
    }

    return (await response.json()) as StakeIntentResponse;
}