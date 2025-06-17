import Web3, { Uint256 } from "web3";
import 'dotenv/config'
import { readFileSync } from 'fs';
import { FireblocksWeb3Provider, ChainId, ApiBaseUrl } from "@fireblocks/fireblocks-web3-provider";
import { ABI } from "./BatchDeposit2ABI.ts";

type CreateStakeIntentRequest = {
  stakes: {
    fee_recipient: string;
    withdrawal_address: string;
    amount: string;
  }[];
};

type CreateStakeIntentResponse = {
  stake_intent_id: string;
  ethereum: {
    stakes: {
      stake_id: string;
      amount: string;
      validator_public_key: string;
      withdrawal_credentials: string;
    }[];
    contract_address: string;
    unsigned_transaction: string;
  };
};


function createStakeIntent(
  bossApiKey: string,
  request: CreateStakeIntentRequest,
): Promise<CreateStakeIntentResponse> {

  // * Create a stake intent with the Staking Integration API: https://docs.blockdaemon.com/reference/postethereumstakeintent
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': bossApiKey,
      //'Idempotency-Key': 'FB81DEED-D58B-4948-B51D-99E2E1064B9C',
    },
    body: JSON.stringify(request),
  };

  return fetch(
    `https://svc.blockdaemon.com/boss/v1/ethereum/${process.env.ETHEREUM_NETWORK}/stake-intents?validator_type=${process.env.ETHEREUM_VALIDATOR_TYPE}`,
    requestOptions,
  ).then(response => {
    if (!response.ok) {
      throw new Error(`Failed to create stake intent: ${response.statusText}`);
    }
    return response.json() as Promise<CreateStakeIntentResponse>;
  });
}

async function main() {

  const gwei = 10n ** 9n;

  // Check for the required environment variables
  if (!process.env.BLOCKDAEMON_STAKE_API_KEY) {
    throw new Error('BLOCKDAEMON_STAKE_API_KEY environment variable not set');
  }

  if (!process.env.ETHEREUM_NETWORK) {
    throw new Error('ETHEREUM_NETWORK environment variable not set.');
  }

  if (!process.env.ETHEREUM_WITHDRAWAL_ADDRESS) {
    throw new Error('ETHEREUM_WITHDRAWAL_ADDRESS environment variable not set');
  }

  if (!process.env.ETHEREUM_VALIDATOR_TYPE) {
    throw new Error('ETHEREUM_VALIDATOR_TYPE environment variable not set');
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

  // Determine FIreblocks Asset ID based on network
  let chainID;
  switch (process.env.ETHEREUM_NETWORK) {
    case "holesky":
      chainID = ChainId.HOLESKY;
      break;
    case "hoodi":
      chainID = ChainId.HOODI;  
      break;
    case "mainnet":
      chainID = ChainId.MAINNET;
      break;
    default:
      throw new Error(`Unsupported network: ${process.env.ETHEREUM_NETWORK}`);
  }

  const eip1193Provider = new FireblocksWeb3Provider({
    apiBaseUrl: ApiBaseUrl.Production,
    privateKey: readFileSync(process.env.FIREBLOCKS_SECRET_KEY, "utf8"),
    apiKey: process.env.FIREBLOCKS_API_KEY,
    vaultAccountIds: process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS,
    chainId: chainID,
    rpcUrl: process.env.RPC_URL,
  });

  const web3 = new Web3(eip1193Provider);

  const addresses = await web3.eth.getAccounts();
  const address = addresses[0];
  console.log("Ethereum addresses:", address);
  console.log("Initial balance:", await web3.eth.getBalance(address));

  const response = await createStakeIntent(process.env.BLOCKDAEMON_STAKE_API_KEY, {
    stakes: [
      {
        amount: '32000000000',
        withdrawal_address: process.env.ETHEREUM_WITHDRAWAL_ADDRESS,
        fee_recipient: process.env.ETHEREUM_WITHDRAWAL_ADDRESS,
      },
    ],
  });

  const { unsigned_transaction, contract_address, stakes } = response.ethereum;
  const totalDepositAmount = stakes.reduce((sum, next) => sum + BigInt(next.amount), 0n) * gwei;

  const contract = new web3.eth.Contract(ABI, contract_address);

  // Decode calldata using Web3's ABI decoder
  let decodedData: {
    deadline: Uint256;
    values: Uint256[];
    argv: Uint8Array;
  };
  try {
    // Verify this is the batchDeposit function comparing the signature from the calldata (first 4 bytes)
    if (unsigned_transaction.slice(0, 10) !== web3.eth.abi.encodeFunctionSignature('batchDeposit(uint256,uint256[],bytes)')) {
      throw new Error(`Unexpected function signature: ${unsigned_transaction.slice(0, 10)}`);
    }

    // Decode the parameters
    const parameters = web3.eth.abi.decodeParameters(
      ['uint256','uint256[]','bytes'],
      '0x' + unsigned_transaction.slice(10)
    );

    decodedData = {
      deadline: parameters[0] as Uint256,
      values: parameters[1] as Uint256[],
      argv: parameters[2] as Uint8Array
    };
  } catch (error) {
    console.error('Error decoding calldata:', error);
    throw new Error('Failed to decode transaction calldata');
  }

  // Invoke batchDeposit method with decoded parameters
  const txid = await contract.methods.batchDeposit(decodedData.deadline, decodedData.values, decodedData.argv).send({
    from: address,
    value: totalDepositAmount.toString(10),
  });

  console.log(`Broadcasted transaction hash: https://${process.env.ETHEREUM_NETWORK}.etherscan.io/tx/${txid.transactionHash}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });