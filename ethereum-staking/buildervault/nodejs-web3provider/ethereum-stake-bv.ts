import Web3, { Uint256 } from "web3";
import 'dotenv/config'
import { createEIP1193Provider } from "@blockdaemon/buildervault-web3-provider";
import { BatchDepositV1ABI } from "./BatchDepositV1ABI.ts";
import { BatchDepositV2ABI } from "./BatchDepositV2ABI.ts";

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

  if (!process.env.BLOCKDAEMON_RPC_URL) {
    throw new Error('BLOCKDAEMON_RPC_URL environment variable not set');
  }

  const chain = {
    chainName: "Ethereum Hoodi",
    chainId: "0x88bb0",
    rpcUrls: [process.env.BLOCKDAEMON_RPC_URL],
  };
  
  const eip1193Provider = await createEIP1193Provider({
    playerCount: Number(process.env.BUILDERVAULT_PLAYER_COUNT),

    player0Url: process.env.BUILDERVAULT_PLAYER0_URL,
    player0MPCpublicKey: process.env.BUILDERVAULT_PLAYER0_MPCPUBLICKEY,

    player1Url: process.env.BUILDERVAULT_PLAYER1_URL,
    player1MPCpublicKey: process.env.BUILDERVAULT_PLAYER1_MPCPUBLICKEY,
    
    player2Url: process.env.BUILDERVAULT_PLAYER2_URL,
    player2MPCpublicKey: process.env.BUILDERVAULT_PLAYER2_MPCPUBLICKEY,

    player0ClientCert: process.env.BUILDERVAULT_PLAYER0_CLIENT_CERT,
    player0ClientKey: process.env.BUILDERVAULT_PLAYER0_CLIENT_KEY,
    player0mTLSpublicKey: process.env.BUILDERVAULT_PLAYER0_MTLSPUBLICKEY,

    player1ClientCert: process.env.BUILDERVAULT_PLAYER1_CLIENT_CERT,
    player1ClientKey: process.env.BUILDERVAULT_PLAYER1_CLIENT_KEY,
    player1mTLSpublicKey: process.env.BUILDERVAULT_PLAYER1_MTLSPUBLICKEY,

    player2ClientCert: process.env.BUILDERVAULT_PLAYER2_CLIENT_CERT,
    player2ClientKey: process.env.BUILDERVAULT_PLAYER2_CLIENT_KEY,
    player2mTLSpublicKey: process.env.BUILDERVAULT_PLAYER2_MTLSPUBLICKEY,

    masterKeyId: process.env.BUILDERVAULT_MASTERKEY_ID!,
    accountId: Number(process.env.BUILDERVAULT_ACCOUNT_ID),
    addressIndex: Number(process.env.BUILDERVAULT_ADDRESS_INDEX),

    chains: [chain],
  })

  const web3 = new Web3(eip1193Provider);

  const addresses = await web3.eth.requestAccounts();
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

  // Map BatchDeposit v1 & v2 function signatures to their respective ABI, parameter types, and decode logic
  const signatures = {
    [web3.eth.abi.encodeFunctionSignature('batchDeposit(uint256,bytes)')]: {
      abi: BatchDepositV1ABI,
      params: ['uint256', 'bytes'],
      // Decode function for v1: returns [validUntil, args]
      decode: (params: any) => [params[0], params[1]],
    },
    [web3.eth.abi.encodeFunctionSignature('batchDeposit(uint256,uint256[],bytes)')]: {
      abi: BatchDepositV2ABI,
      params: ['uint256', 'uint256[]', 'bytes'],
      // Decode function for v2: returns [deadline, values, argv]
      decode: (params: any) => [params[0], params[1], params[2]],
    },
  };

  // Extract the function signature from the calldata
  const sig = unsigned_transaction.slice(0, 10);
  // Lookup the config for the detected signature
  const config = signatures[sig];
  if (!config) throw new Error(`Unexpected function signature: ${sig}`);

  // Instantiate the contract with the correct ABI
  const contract = new web3.eth.Contract(config.abi, contract_address);

  let decodedParams;
  try {
    // Decode the calldata parameters using the ABI definition
    const params = web3.eth.abi.decodeParameters(config.params, '0x' + unsigned_transaction.slice(10));
    // Use the decode function to get the correct argument array
    decodedParams = config.decode(params);
  } catch (error) {
    console.error('Error decoding calldata:', error);
    throw new Error('Failed to decode transaction calldata');
  }

  // Call the batchDeposit method with the decoded parameters
  // Handles both v1 (2 params) and v2 (3 params) signatures
  const txid = await contract.methods.batchDeposit(
    ...(config.params.length === 2
      ? [decodedParams[0], decodedParams[1]]
      : [decodedParams[0], decodedParams[1], decodedParams[2]])
  ).send({
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