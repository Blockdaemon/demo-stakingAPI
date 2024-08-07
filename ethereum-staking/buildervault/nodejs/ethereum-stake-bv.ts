// @ts-ignore
import { TSMClient, Configuration, SessionConfig, curves } from "@sepior/tsmsdkv2";
import fs from "fs";
import { Web3 } from 'web3';
import { keccak256, toHex, toChecksumAddress } from 'web3-utils';
import { TransactionFactory, FeeMarketEIP1559Transaction } from 'web3-eth-accounts';
import crypto from "crypto";
// @ts-ignore
import asn1 from "asn1.js";
import 'dotenv/config'


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
      //'Idempotency-Key': 'C5410A37-82CD-4468-AD29-EE6BE324FF07',
    },
    body: JSON.stringify(request),
  };

  return fetch(
    `https://svc.blockdaemon.com/boss/v1/ethereum/${process.env.ETHEREUM_NETWORK}/stake-intents`,
    requestOptions,
  ).then(response => response.json() as Promise<CreateStakeIntentResponse>);
}

export type EthereumSignature = {
  r: string,
  s: string,
  v: BigInt,
};


async function main() {

  const gwei = 10n ** 9n;

  // Check for the required environment variables
  if (!process.env.BLOCKDAEMON_API_KEY) {
    throw new Error('BLOCKDAEMON_API_KEY environment variable not set');
  }

  if (!process.env.BLOCKDAEMON_STAKE_API_KEY) {
    throw new Error('BLOCKDAEMON_STAKE_API_KEY environment variable not set');
  }

  if (!process.env.ETHEREUM_NETWORK) {
    throw new Error('ETHEREUM_NETWORK environment variable not set.');
  }

  if (!process.env.ETHEREUM_WITHDRAWAL_ADDRESS) {
    throw new Error('ETHEREUM_WITHDRAWAL_ADDRESS environment variable not set');
  }

  // Set buildervault endpoints

	// * BuilderVault mTLS authentication with publickey pinning: https://builder-vault-tsm.docs.blockdaemon.com/docs/authentication-3#public-key-pinning
  const serverMtlsPublicKeys = {
    0: `-----BEGIN CERTIFICATE-----\nMIICMTCCAdegAwIBAgICB+MwCgYIKoZIzj0EAwIwgaAxCzAJBgNVBAYTAlVTMRMw\nEQYDVQQIDApDYWxpZm9ybmlhMRQwEgYDVQQHDAtMb3MgQW5nZWxlczEUMBIGA1UE\nCgwLQmxvY2tkYWVtb24xFDASBgNVBAsMC0Jsb2NrZGFlbW9uMRQwEgYDVQQDDAtC\nbG9ja2RhZW1vbjEkMCIGCSqGSIb3DQEJARYVYWRtaW5AYmxvY2tkYWVtb24uY29t\nMB4XDTI0MDIxMzE3MjE0OFoXDTI5MDIxMzE3MjE0OFowTjELMAkGA1UEBhMCVVMx\nEzARBgNVBAgTCkNhbGlmb3JuaWExFDASBgNVBAcTC0xvcyBBbmdlbGVzMRQwEgYD\nVQQKEwtCbG9ja2RhZW1vbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGlixcUc\nYC0ByeutoHHdi3zxWCg5iPAJcxVLvzBUdD2+XdCWEgS/xwFEef9Tl3xFdfK4iWSQ\nnjmtYMTaHMM6mfWjUjBQMA4GA1UdDwEB/wQEAwIHgDAdBgNVHSUEFjAUBggrBgEF\nBQcDAgYIKwYBBQUHAwEwHwYDVR0jBBgwFoAUW6ouasv5oWo7MZ4ZzlE/mpbDrIMw\nCgYIKoZIzj0EAwIDSAAwRQIgSDKHZmsnylzL8kopFSeo8L6LQGxyd/NsBRb+8STI\n1cECIQChi4cl5nJgTXCBzJEHicnRk/0vl+9zq6iABMV+KTXJxA==\n-----END CERTIFICATE-----`,
    1: `-----BEGIN CERTIFICATE-----\nMIICMjCCAdegAwIBAgICB+MwCgYIKoZIzj0EAwIwgaAxCzAJBgNVBAYTAlVTMRMw\nEQYDVQQIDApDYWxpZm9ybmlhMRQwEgYDVQQHDAtMb3MgQW5nZWxlczEUMBIGA1UE\nCgwLQmxvY2tkYWVtb24xFDASBgNVBAsMC0Jsb2NrZGFlbW9uMRQwEgYDVQQDDAtC\nbG9ja2RhZW1vbjEkMCIGCSqGSIb3DQEJARYVYWRtaW5AYmxvY2tkYWVtb24uY29t\nMB4XDTI0MDIxMzE3MjEzMloXDTI5MDIxMzE3MjEzMlowTjELMAkGA1UEBhMCVVMx\nEzARBgNVBAgTCkNhbGlmb3JuaWExFDASBgNVBAcTC0xvcyBBbmdlbGVzMRQwEgYD\nVQQKEwtCbG9ja2RhZW1vbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKz8yGcE\nYIhaQYCA2As30cRIL2rLrB2uKpcFpydE55RoI3Hw+QaeNCfR5znZQZM4bVVquT4i\nxDGhVnQKU5EQU/WjUjBQMA4GA1UdDwEB/wQEAwIHgDAdBgNVHSUEFjAUBggrBgEF\nBQcDAgYIKwYBBQUHAwEwHwYDVR0jBBgwFoAUW6ouasv5oWo7MZ4ZzlE/mpbDrIMw\nCgYIKoZIzj0EAwIDSQAwRgIhAO9yXpssqar6IdgmEOIfAsha0ZIWG56nwE8/GbyN\nBiTaAiEAhhEClrSm/TzmWxODXamBz0pmQ9qNFsrtbGsDhLOe8O8=\n-----END CERTIFICATE-----`,
  };

  const cert0 = new crypto.X509Certificate(serverMtlsPublicKeys[0]);
  const cert1 = new crypto.X509Certificate(serverMtlsPublicKeys[1]);

  const config0 = await new Configuration("https://tsm-sandbox.prd.wallet.blockdaemon.app:8080");
  await config0.withMTLSAuthentication("./client.key", "./client.crt", cert0.publicKey.export({type: "spki",format: "der"}));

  const config1 = await new Configuration("https://tsm-sandbox.prd.wallet.blockdaemon.app:8081")
  await config1.withMTLSAuthentication("./client.key", "./client.crt", cert1.publicKey.export({type: "spki",format: "der"}));

  // Create clients for two MPC nodes
  const clients: TSMClient[] = [
    await TSMClient.withConfiguration(config0),
    await TSMClient.withConfiguration(config1),
  ];

  const threshold = 1; // * The security threshold for this key https://builder-vault-tsm.docs.blockdaemon.com/docs/security-overview#security-model

  const masterKeyId = await getKeyId(clients, threshold, "key.txt");

  const chainPath = new Uint32Array([44, 60]);

  const pkixPublicKeys: Uint8Array[] = [];

  for (const [_, client] of clients.entries()) {
    const ecdsaApi = client.ECDSA();

    pkixPublicKeys.push(
      await ecdsaApi.publicKey(masterKeyId, chainPath)
    );
  }

  // Validate public keys

  for (let i = 1; i < pkixPublicKeys.length; i++) {
      if (Buffer.compare(pkixPublicKeys[0], pkixPublicKeys[i]) !== 0) {
        throw Error("public keys do not match");
      }
    }
    
  const pkixPublicKey = pkixPublicKeys[0];

  // Convert the public key into an Ethereum address
  const utils = clients[0].Utils();

  const publicKeyBytes = await utils.pkixPublicKeyToUncompressedPoint(
    pkixPublicKey
  );

  // Convert web3 publickey to address
  var publicKeyHex = toHex(publicKeyBytes);
  console.log("Public Key of derived key m/44/60:", publicKeyHex);

  // Remove '0x' prefox 
  if (publicKeyHex.startsWith('0x')) {
    publicKeyHex = publicKeyHex.slice(2);
  }

  // Remove the leading '04' byte (which signifies an uncompressed public key)
  if (publicKeyHex.startsWith('04')) {
    publicKeyHex = publicKeyHex.slice(2);
  }

  // Compute the keccak256 hash of the public key
  const addressBuffer = keccak256(Buffer.from(publicKeyHex, 'hex'));

  // Take the last 20 bytes of the hash, prefix it with '0x', and convert to string
  const address = toChecksumAddress('0x' + addressBuffer.slice(-40));

  console.log(`Ethereum address of derived key m/44/60: ${address}`);


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
  const totalDepositAmount =
    stakes.reduce((sum, next) => sum + BigInt(next.amount), 0n) * gwei;

	// * Using Blockdaemon RPC API for Ethereum: https://docs.blockdaemon.com/reference/how-to-access-ethereum-api
  const web3 = new Web3(`https://svc.blockdaemon.com/ethereum/${process.env.ETHEREUM_NETWORK}/native?apiKey=${process.env.BLOCKDAEMON_API_KEY}`);

  // log initial balances
  console.log("Initial balance:", await web3.eth.getBalance(address));

  // used to calculate the transaction's maxFeePerGas
  const feeData = await web3.eth.calculateFeeData();

  const transaction = FeeMarketEIP1559Transaction.fromTxData(
    {
      chainId: await web3.eth.getChainId(),
      type: 2,
      to: contract_address,
      value: BigInt(totalDepositAmount.toString(10)),
      data: web3.utils.hexToBytes(unsigned_transaction),
      nonce: await web3.eth.getTransactionCount(address as string),
      gasLimit: feeData.gasPrice,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    }
  );

  const txHash = transaction.getMessageToSign(true);
  console.log('Raw Transaction:', web3.utils.toHex(transaction.serialize()));
  console.log('Transaction Hash:', web3.utils.toHex(txHash));
  const {r,s,v} = await signTx(txHash, clients, masterKeyId, chainPath);

  const signedTransaction = transaction._processSignature(v.valueOf(), web3.utils.hexToBytes(r), web3.utils.hexToBytes(s));

  const serializeTx = TransactionFactory.fromTxData(signedTransaction).serialize();
  console.log('Signed Transaction:', web3.utils.toHex(serializeTx));
  const txReceipt = await web3.eth.sendSignedTransaction(serializeTx);

  console.log(`Broadcasted transaction hash: https://${process.env.ETHEREUM_NETWORK}.etherscan.io/tx/${txReceipt.transactionHash}`);
}


async function signTx(
    messageToSign: Uint8Array,
    clients: TSMClient[], 
    masterKeyId: string,
    chainPath: Uint32Array
  ): Promise<EthereumSignature> {
  

    console.log(`Builder Vault signing transaction hash...`);
  
    // ToDo: Change to newStaticSessionConfig once TSM nodes are publically signed

    // The public keys of the other players to encrypt MPC protocol data end-to-end
    const playerB64Pubkeys = [
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtDFBfanInAMHNKKDG2RW/DiSnYeI7scVvfHIwUIRdbPH0gBrsilqxlvsKZTakN8om/Psc6igO+224X8T0J9eMg==",
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqvSkhonTeNhlETse8v3X7g4p100EW9xIqg4aRpD8yDXgB0UYjhd+gFtOCsRT2lRhuqNForqqC+YnBsJeZ4ANxg==",
    ];

    const playerPubkeys = [];
    const playerIds = new Uint32Array(Array(clients.length).fill(0).map((_, i) => i));
    for (const i of playerIds) {
      const pubkey = Buffer.from(playerB64Pubkeys[i], "base64");
      playerPubkeys.push(pubkey);
    }

    const sessionConfig = await SessionConfig.newSessionConfig(await SessionConfig.GenerateSessionID(),  playerIds, playerPubkeys);

    // const sessionConfig = await SessionConfig.newStaticSessionConfig(
    //   await SessionConfig.GenerateSessionID(),
    //   clients.length
    // );

    const partialSignatures: string[] = [];
  
    const partialSignaturePromises: Promise<void>[] = [];
  
    for (const [_, client] of clients.entries()) {
      const func = async (): Promise<void> => {
        const ecdsaApi = client.ECDSA();
  
        const partialSignResult = await ecdsaApi.sign(
          sessionConfig,
          masterKeyId,
          chainPath,
          messageToSign
        );
  
        partialSignatures.push(partialSignResult);
      };
  
      partialSignaturePromises.push(func());
    }
  
    await Promise.all(partialSignaturePromises);
  
    const ecdsaApi = clients[0].ECDSA();
  
    const signature = await ecdsaApi.finalizeSignature(
      messageToSign,
      partialSignatures
    );
  
    // Define ASN.1 structure for decoding
    const ASN1Signature = asn1.define("Signature", function () {
      this.seq().obj(
        this.key("r").int(),
        this.key("s").int()
      );
    });
  
    const decodedSignature = ASN1Signature.decode(Buffer.from(signature.signature));

    return {
      r: "0x" + decodedSignature.r.toString(16),
      s: "0x" + decodedSignature.s.toString(16),
      v: BigInt(signature.recoveryID! + 27),  //  Type 2 transaction with ._processSignature subtracts 27 Post EIP-155 should be: chainId * 2 + 35 + signature.recoveryID;
    };
  }


async function getKeyId(
    clients: TSMClient[],
    threshold: number,
    keyfile: string
  ): Promise<string> {
    if (fs.existsSync(keyfile)) {
      const data = fs.readFileSync(keyfile).toString().trim();
  
      console.log(`Read key with ID ${data} from file ${keyfile}`);
  
      return data;
    }
  
  // ToDo: Change to newStaticSessionConfig once TSM nodes are publically signed

  // The public keys of the other players to encrypt MPC protocol data end-to-end
  const playerB64Pubkeys = [
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtDFBfanInAMHNKKDG2RW/DiSnYeI7scVvfHIwUIRdbPH0gBrsilqxlvsKZTakN8om/Psc6igO+224X8T0J9eMg==",
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqvSkhonTeNhlETse8v3X7g4p100EW9xIqg4aRpD8yDXgB0UYjhd+gFtOCsRT2lRhuqNForqqC+YnBsJeZ4ANxg==",
  ];

  const playerPubkeys = [];
  const playerIds = new Uint32Array(Array(clients.length).fill(0).map((_, i) => i));
  for (const i of playerIds) {
    const pubkey = Buffer.from(playerB64Pubkeys[i], "base64");
    playerPubkeys.push(pubkey);
  }

  const sessionConfig = await SessionConfig.newSessionConfig(await SessionConfig.GenerateSessionID(),  playerIds, playerPubkeys);

  // const sessionConfig = await SessionConfig.newStaticSessionConfig(
  //   await SessionConfig.GenerateSessionID(),
  //   clients.length
  // );

  // * Generate an ECDSA master key: https://builder-vault-tsm.docs.blockdaemon.com/docs/getting-started-demo-tsm-golang
  const masterKeyIds: string[] = [];

  clients.forEach(() => masterKeyIds.push(""));

  const promises: Promise<void>[] = [];

  for (const [i, client] of clients.entries()) {
    const func = async (): Promise<void> => {
      const ecdsaApi = client.ECDSA();

      masterKeyIds[i] = await ecdsaApi.generateKey(
        sessionConfig,
        threshold,
        curves.SECP256K1
      );
    };

    promises.push(func());
  }

  await Promise.all(promises);

  for (let i = 1; i < masterKeyIds.length; i++) {
    if (masterKeyIds[0] !== masterKeyIds[i]) {
      throw Error("Key ids do not match");
    }
  }

  const keyID = masterKeyIds[0];

  console.log(`Generated master key (m) with ID ${keyID} ; saving to file ${keyfile}`);

  fs.writeFileSync(keyfile, `${keyID}\n`);

  return keyID;
}

// run the example
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
