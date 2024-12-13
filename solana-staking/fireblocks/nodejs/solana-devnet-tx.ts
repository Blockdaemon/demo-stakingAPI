import web3 from '@solana/web3.js';
import 'dotenv/config'
import { Fireblocks, FireblocksResponse, CreateTransactionResponse, TransferPeerPathType, TransactionRequest, TransactionResponse, TransactionOperation, TransactionStateEnum } from "@fireblocks/ts-sdk";

import { readFileSync } from 'fs';

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

  const amountLamports = Math.floor(web3.LAMPORTS_PER_SOL * 0.01); // default 1 SOL

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

  //const connection = new web3.Connection(`https://svc.blockdaemon.com/solana/${process.env.SOLANA_NETWORK}/native?apiKey=${process.env.BLOCKDAEMON_API_KEY}`, "confirmed");
  const connection = new web3.Connection(`https://api.${process.env.SOLANA_NETWORK}.solana.com`, "confirmed");  // Todo: change to svc.blockdaemon.com when websockets is supported

  // // Check if validator exists
  // const voteAccounts = await connection.getVoteAccounts('finalized');
  // const found = voteAccounts.current.find(acc => acc.votePubkey.toString() == process.env.SOLANA_VALIDATOR_ADDRESS); 
  // if(!found) {
  //   throw "Validator address is not part of the active validators in the network";
  // }

  // Create a Fireblocks API instance
  const fireblocks = new Fireblocks({
    apiKey: process.env.FIREBLOCKS_API_KEY,
    basePath: process.env.FIREBLOCKS_BASE_PATH, // Basepath.Sandbox for the sandbox env
    secretKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
  });
  //const balance = (await fireblocks.getVaultAccountAsset(this.vaultAccountId, this.testNet? 'SOL_TEST': 'SOL')).available;

  const destAddressHex = "BwnMcTUT1wc5VDMvKQ8f1KGz6xGPxRnLGjqZU1fdWbVW"  // SOL devnet Faucet
  let toAccount = new web3.PublicKey(destAddressHex)
      
  // Send and confirm transaction

  let latestBlockhash = await connection.getLatestBlockhash()
  let transaction = new web3.Transaction({
      recentBlockhash: latestBlockhash.blockhash,
      feePayer: delegatorAddress,
  })
  transaction.add(
      web3.SystemProgram.transfer({
          fromPubkey: delegatorAddress,
          toPubkey: toAccount,
          lamports: amountLamports,
      }),
  )

  // Check the balance of the delegator

  const delegatorBalance = await connection.getBalance(delegatorAddress);
  const fee = await transaction.getEstimatedFee(connection);
  if (fee === null) { throw new Error('Failed to estimate fee'); }
  console.log(`Balance at account m/44/501 ${delegatorAddress}: ${delegatorBalance}`)

  if (delegatorBalance <= 0) {
      console.log(`
          Insufficient funds
          Insert additional funds at address ${delegatorAddress} e.g. by visiting https://solfaucet.com
          Then run this program again. 
      `)
      return
  }

  // Sign the transaction
  const messageToSign = transaction.serializeMessage();

  //console.log(`Transaction hash to sign base64: ${transaction.serializeMessage().toString("base64")}\n`);
  console.log(`Serialized transaction to sign (base64): https://explorer.solana.com/tx/inspector?cluster=${process.env.SOLANA_NETWORK}&message=${messageToSign.toString("base64")}\n`);
  const signature = await signTx(messageToSign.toString("hex"), fireblocks, process.env.FIREBLOCKS_VAULT_ACCOUNT_ID);
  if (!signature) { throw new Error('Failed to sign transaction'); }

  transaction.addSignature(delegatorAddress, signature);
  if (!transaction.verifySignatures()) { throw new Error('Failed to verify signatures'); }

  // Broadcast the transaction

  console.log(`Full signed transaction base64: ${transaction.serialize().toString("base64")}\n`);


  const txid = await connection.sendRawTransaction(transaction.serialize());

  // const latestBlockhash = await connection.getLatestBlockhash();
  // const txid = await web3.sendAndConfirmRawTransaction(connection, transaction.serialize(),
  // {
  //   signature: bs58.encode(signature),
  //   blockhash: latestBlockhash.blockhash,
  //   lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  // })

  console.log(`Confirmed transaction: https://explorer.solana.com/tx/${txid}/?cluster=${process.env.SOLANA_NETWORK}`)
}


const signTx = async (
  messageToSign: string,
  fireblocks: Fireblocks,
  vaultAccount: string,
): Promise<Buffer | undefined> => {

  //const messageHash = crypto.createHash("sha256").update(messageToSign).digest();
  //const messageToSignHex = Buffer.from(messageToSign).toString("hex")
  
  const transactionPayload: TransactionRequest = {
    // externalTxId: "<idempotency key>",
    assetId: "SOL_TEST",
    operation: TransactionOperation.Raw,
    source: {
      type: TransferPeerPathType.VaultAccount,
      id: vaultAccount,
    },
    //note: ``,
    extraParameters: {
      rawMessageData: {
        //algorithm: "MPC_EDDSA_ED25519",
        messages: [
          {
            content: messageToSign // The message to be signed in hex format encoding
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
     throw Error("Signing failed");
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
      await new Promise((resolve) => setTimeout(resolve, 4000));

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