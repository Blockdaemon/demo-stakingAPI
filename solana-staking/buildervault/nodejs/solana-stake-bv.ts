import { TSMClient, Configuration, SessionConfig, curves } from "@sepior/tsmsdkv2";
import web3 from '@solana/web3.js';
import bs58 from 'bs58';
import fs from "fs";
import crypto from "crypto";
import 'dotenv/config'

export type StakeIntentRequest = {
  amount: string;
  validator_address: string;
  delegator_address: string;
  staking_authority?: string;
  withdrawal_authority?: string;
  plan_id?: string;
};

export type StakeIntentResponce = {
  stake_intent_id: string;
  protocol: string;
  network: string;
  solana: {
    stake_id: string;
    amount: string;
    validator_public_key: string;
    staking_authority: string;
    withdrawal_authority: string;
    stake_account_public_key: string;
    unsigned_transaction: string;
  };
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

  // * BuilderVault mTLS authentication with publickey pinning: https://builder-vault-tsm.docs.blockdaemon.com/docs/authentication-3#public-key-pinning

  const serverMtlsPublicKeys = {
    0: `-----BEGIN CERTIFICATE-----\nMIICMjCCAdegAwIBAgICB+MwCgYIKoZIzj0EAwIwgaAxCzAJBgNVBAYTAlVTMRMw\nEQYDVQQIDApDYWxpZm9ybmlhMRQwEgYDVQQHDAtMb3MgQW5nZWxlczEUMBIGA1UE\nCgwLQmxvY2tkYWVtb24xFDASBgNVBAsMC0Jsb2NrZGFlbW9uMRQwEgYDVQQDDAtC\nbG9ja2RhZW1vbjEkMCIGCSqGSIb3DQEJARYVYWRtaW5AYmxvY2tkYWVtb24uY29t\nMB4XDTI0MTIxMDE0MjQyOVoXDTI5MTIxMDE0MjQyOVowTjELMAkGA1UEBhMCVVMx\nEzARBgNVBAgTCkNhbGlmb3JuaWExFDASBgNVBAcTC0xvcyBBbmdlbGVzMRQwEgYD\nVQQKEwtCbG9ja2RhZW1vbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFyD6P8s\n/asEB/7ERpHxye5cpZXXtRYh299ioHemPdKzpmmYqyKqv4G7leXT4bZsAPwqzG3+\nQRg/8HPJA9a8hW2jUjBQMA4GA1UdDwEB/wQEAwIHgDAdBgNVHSUEFjAUBggrBgEF\nBQcDAgYIKwYBBQUHAwEwHwYDVR0jBBgwFoAUW6ouasv5oWo7MZ4ZzlE/mpbDrIMw\nCgYIKoZIzj0EAwIDSQAwRgIhAJZZITPjl9cZNrM1TPRtYo6+TQZw/Q1SO+3xZ5T5\nedeeAiEAlpVDC79W6ym30J6f3gSvOQOJO30+AsJs8gQycf8KK2A=\n-----END CERTIFICATE-----`,
    1: `-----BEGIN CERTIFICATE-----\nMIICMDCCAdegAwIBAgICB+MwCgYIKoZIzj0EAwIwgaAxCzAJBgNVBAYTAlVTMRMw\nEQYDVQQIDApDYWxpZm9ybmlhMRQwEgYDVQQHDAtMb3MgQW5nZWxlczEUMBIGA1UE\nCgwLQmxvY2tkYWVtb24xFDASBgNVBAsMC0Jsb2NrZGFlbW9uMRQwEgYDVQQDDAtC\nbG9ja2RhZW1vbjEkMCIGCSqGSIb3DQEJARYVYWRtaW5AYmxvY2tkYWVtb24uY29t\nMB4XDTI0MTIxMDE0MjQ0OVoXDTI5MTIxMDE0MjQ0OVowTjELMAkGA1UEBhMCVVMx\nEzARBgNVBAgTCkNhbGlmb3JuaWExFDASBgNVBAcTC0xvcyBBbmdlbGVzMRQwEgYD\nVQQKEwtCbG9ja2RhZW1vbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDm0QCLd\nOUS/P7tR6mmbUD9CL/qTgRTu76U3oIB5QYGj7lDHo8ngnBknVRoz9q+vsk3HvLXK\nAFAcIHsiYQjPJvujUjBQMA4GA1UdDwEB/wQEAwIHgDAdBgNVHSUEFjAUBggrBgEF\nBQcDAgYIKwYBBQUHAwEwHwYDVR0jBBgwFoAUW6ouasv5oWo7MZ4ZzlE/mpbDrIMw\nCgYIKoZIzj0EAwIDRwAwRAIgVjSlH7sjQ1yus/A2J4mUh3gGljPQaip7ud4ctxdv\n5hUCIG4gazgsH8T0MOdUFdpJovjcxv2KoMl+xQZmYy/G9Pyb\n-----END CERTIFICATE-----`,
  };

  const cert0 = new crypto.X509Certificate(serverMtlsPublicKeys[0]);
  const cert1 = new crypto.X509Certificate(serverMtlsPublicKeys[1]);

  const config0 = await new Configuration("https://tsm-sandbox.prd.wallet.blockdaemon.app:8080");
  await config0.withPublicKeyPinning(cert0.publicKey.export({type: "spki",format: "der"}));
  await config0.withMTLSAuthentication("./client.key", "./client.crt",false, "", "", "", "");

  const config1 = await new Configuration("https://tsm-sandbox.prd.wallet.blockdaemon.app:8081")
  await config1.withPublicKeyPinning(cert1.publicKey.export({type: "spki",format: "der"}));
  await config1.withMTLSAuthentication("./client.key", "./client.crt",false, "", "", "", "");

  // Create clients for two MPC nodes
  const clients: TSMClient[] = [
    await TSMClient.withConfiguration(config0),
    await TSMClient.withConfiguration(config1),
  ];

  const threshold = 1; // The security threshold for this key

  const masterKeyId = await getKeyId(clients, threshold, "key.txt");

  // Get the public key for the derived key m/44/501

  const chainPath = new Uint32Array([44, 501]);

  const publickeys: Uint8Array[] = [];

  for (const [_, client] of clients.entries()) {
    const eddsaApi = client.Schnorr();

    publickeys.push(
      await eddsaApi.publicKey(masterKeyId, chainPath)
    );
  }

  // Validate public keys

  for (let i = 1; i < publickeys.length; i++) {
      if (Buffer.compare(publickeys[0], publickeys[i]) !== 0) {
        throw Error("public keys do not match");
      }
    }


  // Convert the Ed25519 public key to Base58 Solana address

  const compressedPublicKey = await clients[0].Utils().jsonPublicKeyToCompressedPoint(publickeys[0]);
  const delegatorAddress = new web3.PublicKey(bs58.encode(compressedPublicKey));
  console.log(`Solana address of derived key m/44/501: ${delegatorAddress}\n`);

  // * Using Blockdaemon RPC API for Solana: https://docs.blockdaemon.com/reference/how-to-access-solana-api

  const connection = new web3.Connection(`https://svc.blockdaemon.com/solana/${process.env.SOLANA_NETWORK}/native?apiKey=${process.env.BLOCKDAEMON_API_KEY}`, "confirmed");

  // Check if validator exists
  const voteAccounts = await connection.getVoteAccounts('finalized');
  const found = voteAccounts.current.find(acc => acc.votePubkey.toString() == process.env.SOLANA_VALIDATOR_ADDRESS); 
  if(!found) {
    throw "Validator address is not part of the active validators in the network";
  }

  // * Create a stake intent with the Staking Integration API: https://docs.blockdaemon.com/reference/postsolanastakeintent

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
  const signature = await signTx(transaction.serializeMessage(),clients, masterKeyId, chainPath);
  if (!signature) { throw new Error('Failed to sign transaction'); }

  transaction.addSignature(delegatorAddress,signature);
  if (!transaction.verifySignatures()) { throw new Error('Failed to verify signatures'); }

  // Broadcast the transaction

  console.log(`Full signed transaction base64: ${transaction.serialize().toString("base64")}\n`);
  const txid = await connection.sendRawTransaction(transaction.serialize());
  console.log(`Broadcasted transaction: https://explorer.solana.com/tx/${txid}/?cluster=${process.env.SOLANA_NETWORK}`)
}


// Function for creating a stake intent with the Staking Integration API
function createStakeIntent(
  bossApiKey: string,
  request: StakeIntentRequest,
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


async function signTx(
  messageToSign: Uint8Array,
  clients: TSMClient[], 
  masterKeyId: string,
  chainPath: Uint32Array
): Promise<any> {

  // * Builder Vault signing operation: https://builder-vault-tsm.docs.blockdaemon.com/docs/key-generation-and-signing#signing

  console.log(`Builder Vault signing transaction hash...`);

  const partialSignatures: Uint8Array[] = [];

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

  const partialSignaturePromises: Promise<void>[] = [];

  for (const [_, client] of clients.entries()) {
    const func = async (): Promise<void> => {
      const eddsaApi = client.Schnorr();
      console.log(`Creating partialSignature with MPC player ${_}...`);

      const partialSignResult = await eddsaApi.sign(
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

  const eddsaApi = clients[0].Schnorr();

  const signature = await eddsaApi.finalizeSignature(
    messageToSign,
    partialSignatures
  );

  return signature;
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

  // * Builder Vault Key Generation: https://builder-vault-tsm.docs.blockdaemon.com/docs/key-generation-and-signing#key-generation

  const masterKeyIds: string[] = [];

  clients.forEach(() => masterKeyIds.push(""));

  const promises: Promise<void>[] = [];

  for (const [i, client] of clients.entries()) {
    const func = async (): Promise<void> => {
      const eddsaApi = client.Schnorr();
      console.log(`Generating key using MPC player ${i}`);
      masterKeyIds[i] = await eddsaApi.generateKey(sessionConfig, threshold, curves.ED25519,"");
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

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });