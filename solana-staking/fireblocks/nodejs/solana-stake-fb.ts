import web3 from '@solana/web3.js';
import bs58 from 'bs58';
import fs from "fs";
import crypto from "crypto";
import 'dotenv/config'
import { Fireblocks, FireblocksResponse, CreateTransactionResponse, TransferPeerPathType, TransactionRequest, TransactionResponse, TransactionOperation, TransactionStateEnum } from "@fireblocks/ts-sdk";


export type StakeIntentSolanaRequest = {
  amount: string;
  validator_address: string;
  delegator_address: string;
  staking_authority?: string;
  withdrawal_authority?: string;
  plan_id?: string;
};

export type StakeIntentSolana = {
  stake_id: string;
  amount: string;
  validator_public_key: string;
  staking_authority: string;
  withdrawal_authority: string;
  stake_account_public_key: string;
  unsigned_transaction: string;
};

export type StakeIntentResponce = {
  stake_intent_id: string;
  protocol: string;
  network: string;
  solana?: StakeIntentSolana;
  customer_id?: string;
};

async function main() {

  const amountLamports = Math.floor(web3.LAMPORTS_PER_SOL * 1); // default 1 SOL

  // Check for the required environment variables
  if (!process.env.BLOCKDAEMON_API_KEY) {
    throw new Error('BLOCKDAEMON_API_KEY environment variable not set');
  }

  if (!process.env.BLOCKDAEMON_STAKE_API_KEY) {
    throw new Error('BLOCKDAEMON_STAKE_API_KEY environment variable not set');
  }

  if (!process.env.SOLANA_NETWORK) {
    throw new Error('SOLANA_NETWORK environment variable not set.');
  }

  if (!process.env.SOLANA_VALIDATOR_ADDRESS) {
    throw new Error('SOLANA_VALIDATOR_ADDRESS environment variable not set');
  }

  if (!process.env.FIREBLOCKS_BASE_PATH) {
    throw new Error('FIREBLOCKS_BASE_PATH environment variable not set');
  }

  if (!process.env.FIREBLOCKS_API_KEY) {
    throw new Error('FIREBLOCKS_API_KEY environment variable not set');
  }

  if (!process.env.FIREBLOCKS_SECRET_KEY) {
    throw new Error('FIREBLOCKS_SECRET_KEY environment variable not set');
  }

  if (!process.env.FIREBLOCKS_VAULT_ACCOUNT_ID) {
    throw new Error('FIREBLOCKS_VAULT_ACCOUNT_ID environment variable not set');
  }

  if (!process.env.FIREBLOCKS_DELEGATOR_PUBLICKEY) {
    throw new Error('FIREBLOCKS_DELEGATOR_PUBLICKEY environment variable not set');
  }

  const delegatorAddress = new web3.PublicKey(process.env.FIREBLOCKS_DELEGATOR_PUBLICKEY);
  console.log(`Solana address of derived key m/44/501: ${delegatorAddress}\n`);

  //const connection = new web3.Connection(`https://svc.blockdaemon.com/solana/${process.env.SOLANA_NETWORK}/native?apiKey=${process.env.BLOCKDAEMON_API_KEY}`, "confirmed");
  const connection = new web3.Connection(`https://api.${process.env.SOLANA_NETWORK}.solana.com`, "confirmed");  // Todo: change to svc.blockdaemon.com when websockets is supported

  // Check if validator exists
  const voteAccounts = await connection.getVoteAccounts('finalized');
  const found = voteAccounts.current.find(acc => acc.votePubkey.toString() == process.env.SOLANA_VALIDATOR_ADDRESS); 
  if(!found) {
    throw "Validator address is not part of the active validators in the network";
  }

  // Create a Fireblocks API instance
  const fireblocks = new Fireblocks({
    apiKey: process.env.FIREBLOCKS_API_KEY,
    basePath: process.env.FIREBLOCKS_BASE_PATH, // Basepath.Sandbox for the sandbox env
    secretKey: process.env.FIREBLOCKS_SECRET_KEY,
  });
  

  // Create a stake intent with the Staking Integration API

  const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY, {
    amount: amountLamports.toString(),
    validator_address: process.env.SOLANA_VALIDATOR_ADDRESS,
    // By default `staking_authority` and `withdrawal_authority` will be
    // the same as delegator address
    delegator_address: delegatorAddress.toString(),
    // Todo: add Plan-ID
  });
  if (!response.solana) {
    throw "Missing property `solana` in BOSS responce";
  }

  // Get the unsigned transaction data returned by the Staking Integration API

  const unsigned_transaction = response.solana.unsigned_transaction;
  const transaction = web3.Transaction.from(Buffer.from(unsigned_transaction, 'hex'));

  // Check the balance of the delegator

  const delegatorBalance = await connection.getBalance(delegatorAddress);
  const fee = await transaction.getEstimatedFee(connection);
  if (fee === null) { throw new Error('Failed to estimate fee'); }
  const delegatedAmount = Number(response.solana.amount);
  if (delegatorBalance < delegatedAmount + fee) { throw `Insufficient funds: ${delegatorAddress} Balance: ${delegatorBalance}, Required: ${delegatedAmount + fee}` }


  // Sign the transaction

  console.log(`Transaction hash to sign base64: ${transaction.serializeMessage().toString("base64")}\n`);
  const signature = await signTx(transaction.serializeMessage(), fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID);
  if (!signature) { throw new Error('Failed to sign transaction'); }

  transaction.addSignature(delegatorAddress, signature);
  if (!transaction.verifySignatures()) { throw new Error('Failed to verify signatures'); }

  // Broadcast the transaction

  console.log(`Full signed transaction base64: ${transaction.serialize().toString("base64")}\n`);
  const latestBlockhash = await connection.getLatestBlockhash();
  const txid = await web3.sendAndConfirmRawTransaction(connection, transaction.serialize(),
  {
    signature: bs58.encode(signature),
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  })

  console.log(`Confirmed transaction: https://explorer.solana.com/tx/${txid}/?cluster=${process.env.SOLANA_NETWORK}`)
}


// Function for creating a stake intent with the Staking Integration API
function createStakeIntent(
  bossApiKey: string,
  request: StakeIntentSolanaRequest,
): Promise<StakeIntentResponce>  {
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': bossApiKey,
      //'Idempotency-Key': '1CAB9C75-4F4D-446C-B492-0198187C228',
    },
    body: JSON.stringify(request),
  };

  // return the response from POST Create a New Stake Intent
  return fetch(
      `https://svc.blockdaemon.com/boss/v1/solana/${process.env.SOLANA_NETWORK}/stake-intents`,
    requestOptions
  ).then(async response => {
    if (response.status != 200) {
      throw await response.json();
    }
    return response.json() as Promise<StakeIntentResponce>
  })
}


const signTx = async (
  messageToSign: Uint8Array,
  fireblocks: Fireblocks,
  vaultAccount: string,
): Promise<Buffer | undefined> => {

  //const messageHash = crypto.createHash("sha256").update(messageToSign).digest();
  const messageToSignHex = Buffer.from(messageToSign).toString("hex")

  const transactionPayload: TransactionRequest = {
    // externalTxId: "<idempotency key>",
    assetId: "SOL", // "SOL_TEST"
    operation: TransactionOperation.Raw,
    source: {
      type: TransferPeerPathType.VaultAccount,
      id: vaultAccount,
    },
    note: ``,
    extraParameters: {
      rawMessageData: {
        algorithm: "MPC_EDDSA_ED25519",
        messages: [
          {
            messageToSignHex // The message to be signed in hex format encoding
          },
        ],
      },
    },
  };
  
  let txInfo: any;
  try {
    const transactionResponse = await fireblocks.transactions.createTransaction(
      {
        transactionRequest: transactionPayload,
      },
    );

    //console.log(transactionPayload.extraParameters.rawMessageData);
    const txId = transactionResponse.data.id;
    if (!txId) {
      throw new Error("Transaction ID is undefined.");
    }
    const txInfo = await getTxStatus(txId,fireblocks);
    console.log(JSON.stringify(txInfo, null, 2));
    //const signature = txInfo.signedMessages[0].signature;
  } catch (error) {
    console.error(error);
  }
  
  const signature = txInfo.signedMessages[0].signature;
  console.log(JSON.stringify(signature));

  return Buffer.from(signature.fullSig);
};


const getTxStatus = async (
  txId: string,
  fireblocks:Fireblocks): Promise<TransactionResponse> => {
  try {
    let response: FireblocksResponse<TransactionResponse> =
      await fireblocks.transactions.getTransaction({ txId });
    let tx: TransactionResponse = response.data;
    let messageToConsole: string = `Transaction ${tx.id} is currently at status - ${tx.status}`;

    console.log(messageToConsole);
    while (tx.status !== TransactionStateEnum.Completed) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      response = await fireblocks.transactions.getTransaction({ txId });
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
    while (tx.status !== TransactionStateEnum.Completed);
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