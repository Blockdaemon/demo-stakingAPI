const { TSMClient, Configuration, SessionConfig, curves } = require("@sepior/tsmsdkv2");
const fs = require("node:fs");
const web3 = require("@solana/web3.js");
const bs58 = require('bs58').default;
import 'dotenv/config'
import { Fireblocks, FireblocksResponse, CreateTransactionResponse, TransferPeerPathType, TransactionRequest, TransactionResponse, TransactionOperation, TransactionStateEnum } from "@fireblocks/ts-sdk";


async function main() {
  
  // destination address
  const destAddressHex = "4ETf86tK7b4W72f27kNLJLgRWi9UfJjgH4koHGUXMFtn"  // SOL testnet Faucet
  const amountLamports = 1000 // default 0.000001 SOL

  // Set buildervault endpoints
  const config0 = await new Configuration("http://localhost:8500")
  await config0.withAPIKeyAuthentication("apikey0")

  const config1 = await new Configuration("http://localhost:8501")
  await config1.withAPIKeyAuthentication("apikey1")

  // Create clients for two MPC nodes
  const clients = [
    await TSMClient.withConfiguration(config0),
    await TSMClient.withConfiguration(config1),
  ]

  const threshold = 1 // The security threshold for this key

  const masterKeyId = await getKeyId(clients, threshold, "key.txt")

  // Get the public key for the derived key m/44/501

  const chainPath = new Uint32Array([44, 501])

  const publickeys = []

  for (const [_, client] of clients.entries()) {
    const eddsaApi = client.Schnorr()

    publickeys.push(
      await eddsaApi.publicKey(masterKeyId, chainPath)
    )
  }

  // Validate public keys

  for (let i = 1; i < publickeys.length; i++) {
      if (Buffer.compare(publickeys[0], publickeys[i]) !== 0) {
        throw Error("public keys do not match")
      }
    }

  // Convert PublicKey to Base58 Solana address

  const compressedPublicKey = await clients[0].Utils().pkixPublicKeyToCompressedPoint(publickeys[0])
  const address = new web3.PublicKey(bs58.encode(compressedPublicKey))
  console.log(`Solana address of derived key m/44/501: ${address}`)

  // Initialize Solana client
  const apiKey = process.env.API_KEY

  if (!apiKey) {
      console.log('API_KEY environment variable not set')
      return
  }

  const solanaNodeUrl = `https://svc.blockdaemon.com/solana/testnet/native?apiKey=${apiKey}`
 
  let connection = new web3.Connection(solanaNodeUrl, "confirmed")
  
  const balance = await connection.getBalance(address);

  console.log(`Balance at account m/44/501 ${address}: ${balance}`)

  if (balance <= 0) {
      console.log(`
          Insufficient funds
          Insert additional funds at address ${address} e.g. by visiting https://solfaucet.com
          Then run this program again. 
      `)
      return
  }

  let toAccount = new web3.PublicKey(destAddressHex)
      
  // Send and confirm transaction

  let latestBlockhash = await connection.getLatestBlockhash()
  let transaction = new web3.Transaction({
      recentBlockhash: latestBlockhash.blockhash,
      feePayer: address,
  })
  transaction.add(
      web3.SystemProgram.transfer({
          fromPubkey: address,
          toPubkey: toAccount,
          lamports: amountLamports,
      }),
  )

  const messageToSign = transaction.serializeMessage()

  // Use the TSM to sign via the derived key m/44/501

  console.log(`Signing transaction using Builder Vault: ${messageToSign.toString('hex')}`)
  
  const partialSignatures = []

  const sessionConfig = await SessionConfig.newStaticSessionConfig(
    await SessionConfig.GenerateSessionID(),
    clients.length
  )

  const partialSignaturePromises = []

  for (const [_, client] of clients.entries()) {
    const func = async () => {
      const eddsaApi = client.Schnorr()

      const partialSignResult = await eddsaApi.sign(
        sessionConfig,
        masterKeyId,
        chainPath,
        messageToSign
      )

      partialSignatures.push(partialSignResult)
    }

    partialSignaturePromises.push(func())
  }

  await Promise.all(partialSignaturePromises)

  const eddsaApi = clients[0].Schnorr()

  const signature = await eddsaApi.finalizeSignature(
    messageToSign,
    partialSignatures
  )
  
  transaction.addSignature(address, signature.signature)
  console.log(`The signatures were verified: ${transaction.verifySignatures()}`)

  // Send the transaction

  console.log("Raw signed message base64:", transaction.serialize().toString("base64"))
  const txid = await connection.sendRawTransaction(transaction.serialize());
  console.log(`Confirmed transaction: https://explorer.solana.com/tx/${txid}/?cluster=testnet`)
}

async function getKeyId(clients, threshold, keyfile) {
  if (fs.existsSync(keyfile)) {
    const data = fs.readFileSync(keyfile).toString().trim()

    console.log(`Read key with ID ${data} from file ${keyfile}`)

    return data
  }

  const sessionConfig = await SessionConfig.newStaticSessionConfig(
    await SessionConfig.GenerateSessionID(),
    clients.length
  )

  const masterKeyIds = []

  clients.forEach(() => masterKeyIds.push(""))

  const promises = []

  for (const [i, client] of clients.entries()) {
    const func = async () => {
      const eddsaApi = client.Schnorr()

      masterKeyIds[i] = await eddsaApi.generateKey(sessionConfig, threshold,curves.ED25519)
    }

    promises.push(func())
  }

  await Promise.all(promises)

  for (let i = 1; i < masterKeyIds.length; i++) {
    if (masterKeyIds[0] !== masterKeyIds[i]) {
      throw Error("Key ids do not match")
    }
  }

  const keyID = masterKeyIds[0]

  console.log(`Generated master key (m) with ID ${keyID}  saving to file ${keyfile}`)

  fs.writeFileSync(keyfile, `${keyID}\n`)

  return keyID
}

main()
