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

export type BondExtraResponse = {
    network: string;
    polkadot: {
        customer_address: string;
        amount: string;
        unsigned_transaction: string;
    };
    protocol: string;
}

export type DeriveTransactionResponse = {
    signing_payload: string;
    unsigned_tx: string;
};

export type CompileAndSendResponse = {
    id: string;
};

// Request Body Types
export type StakeIntentRequest = {
    customer_address: string;
};

export type BondExtraRequest = {
    customer_address: string;
    amount: string;
};

export type PrepareTransactionRequest = {
    sender_address: string;
    unsigned_tx: string;
};

export type CompileAndSendRequest = {
    signature_schema: "ed25519";
    signature: string;
    unsigned_tx: string;
    public_key: string;
};

// Fetch Stake Intent
export async function fetchUnsignedTransaction(delegatorAddress: string): Promise<StakeIntentResponse> {
    const requestBody: StakeIntentRequest = { customer_address: delegatorAddress };
    const response = await fetch(
        `https://svc.blockdaemon.com/boss/v1/polkadot/${process.env.POLKADOT_NETWORK}/stake-intents`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-API-Key": process.env.BLOCKDAEMON_STAKE_API_KEY!,
            },
            body: JSON.stringify(requestBody),
        }
    );

    if (response.status !== 200) {
        throw new Error(`Blockdaemon API Error: ${JSON.stringify(await response.json())}`);
    }

    return (await response.json()) as StakeIntentResponse;
}

// Fetch Bond Extra
export async function fetchBondExtraTransaction(delegatorAddress: string, amount: string): Promise<BondExtraResponse> {
    const requestBody: BondExtraRequest = { customer_address: delegatorAddress, amount: amount };
    const response = await fetch(
        `https://svc.blockdaemon.com/boss/v1/polkadot/${process.env.POLKADOT_NETWORK}/bond-extra`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-API-Key": process.env.BLOCKDAEMON_STAKE_API_KEY!,
            },
            body: JSON.stringify(requestBody),
        }
    );

    if (response.status !== 200) {
        throw new Error(`Blockdaemon API Error: ${JSON.stringify(await response.json())}`);
    }

    return (await response.json()) as BondExtraResponse;
}

// Prepare Transaction
export async function prepareTransaction(unsignedTx: string, address: string, compileAndSendUrl: string): Promise<DeriveTransactionResponse> {
    const requestBody: PrepareTransactionRequest = {
        sender_address: address,
        unsigned_tx: unsignedTx,
    };

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.BLOCKDAEMON_API_KEY!}`,
        },
        body: JSON.stringify(requestBody),
    };

    const response = await fetch(compileAndSendUrl, requestOptions);
    const responseData = await response.json();

    if (response.status !== 200) {
        throw new Error(`Error: ${JSON.stringify(responseData)}`);
    }

    console.log('Transaction sent successfully:', responseData);
    return responseData as DeriveTransactionResponse;
}

// Compile and Send Transaction
export async function compileAndSend(unsignedTx: string, signature: string, publicKey: string, compileAndSendUrl: string): Promise<CompileAndSendResponse> {
    const requestBody: CompileAndSendRequest = {
        signature_schema: "ed25519",
        signature: signature,
        unsigned_tx: unsignedTx,
        public_key: publicKey,
    };

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.BLOCKDAEMON_API_KEY!}`,
        },
        body: JSON.stringify(requestBody),
    };

    const response = await fetch(compileAndSendUrl, requestOptions);
    const responseData = await response.json();

    if (response.status !== 200) {
        throw new Error(`Error: ${JSON.stringify(responseData)}`);
    }

    console.log('Transaction sent successfully:', responseData);
    return responseData as CompileAndSendResponse;
}
