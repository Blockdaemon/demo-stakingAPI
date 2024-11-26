package example

import co.nstant.`in`.cbor.CborDecoder
import co.nstant.`in`.cbor.model.DataItem
import com.fireblocks.sdk.ApiResponse
import com.fireblocks.sdk.ConfigurationOptions
import com.fireblocks.sdk.Fireblocks
import com.fireblocks.sdk.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.apache.commons.codec.binary.Hex
import org.bouncycastle.crypto.digests.Blake2bDigest
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Paths
import java.util.*
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import com.beust.klaxon.JsonObject
import com.beust.klaxon.Parser
import com.bloxbean.cardano.client.transaction.spec.*
import com.bloxbean.cardano.client.transaction.spec.Transaction
import com.bloxbean.cardano.client.util.*
import co.nstant.`in`.cbor.model.Map as CborMap


class CardanoStakingService {
    private val client = OkHttpClient()
    private val CHIMERIC_INDEX = 2
    fun initializeFireblocksConfiguration(): ConfigurationOptions {
        val apiKey = System.getenv("FIREBLOCKS_API_KEY")
            ?: throw IllegalStateException("Environment variable FIREBLOCKS_API_KEY is not set")

        val secretKeyPath = System.getenv("FIREBLOCKS_SECRET_KEY")
            ?: throw IllegalStateException("Environment variable FIREBLOCKS_SECRET_KEY is not set")

        // Read the secret key from the file
        val secretKey = Files.readString(Paths.get(secretKeyPath), StandardCharsets.UTF_8).trim()

        // Initialize ConfigurationOptions
        return ConfigurationOptions()
            .apiKey(apiKey)
            .secretKey(secretKey)
            .basePath("https://api.fireblocks.io/v1")
    }

    private var options = initializeFireblocksConfiguration();
    private var fireblocks: Fireblocks = Fireblocks(options)


    fun createStakeIntent(baseAddress: String): String {
        val url = "https://svc.blockdaemon.com/boss/v1/cardano/preprod/stake-intents"
        val jsonPayload = """{"base_address": "$baseAddress"}"""

        val requestBody = jsonPayload.toRequestBody("application/json".toMediaType())

        val apiKey = System.getenv("BLOCKDAEMON_STAKE_API_KEY")
            ?: throw IllegalStateException("Environment variable BLOCKDAEMON_STAKE_API_KEY is not set")

        val request = Request.Builder()
            .url(url)
            .post(requestBody)
            .addHeader("accept", "application/json")
            .addHeader("content-type", "application/json")
            .addHeader("X-API-Key", apiKey)
            .build()


        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Unexpected code $response")
            }

            val responseBody = response.body?.string() ?: throw Exception("Response body is null")

            val parsedJson = Parser.default().parse(StringBuilder(responseBody)) as JsonObject
            val cardanoObject = parsedJson.obj("cardano")
                ?: throw Exception("Cardano object not found in response")

            return cardanoObject.string("unsigned_transaction")
                ?: throw Exception("Unsigned transaction not found in Cardano object")
        }
    }

    fun decodeAndHashTransaction(unsignedTransactionHex: String): String {
        // Decode the hex string to bytes
        val unsignedTransactionBytes = unsignedTransactionHex.hexStringToByteArray()

        // Compute the Blake2b hash of the transaction
        val hash = blake2bHash(unsignedTransactionBytes)
        return Hex.encodeHexString(hash)
    }


    fun signTx(
        unsignedTransaction: String,
        vaultAccount: String,
        assetID: String
    ): List<Map<String, String>>? {
        // Hash the unsigned transaction
        val unsignedHash = decodeAndHashTransaction(unsignedTransaction)
        val idempotencyKey = UUID.randomUUID().toString()

        // Construct extraParameters
        val extraParameters = mapOf(
            "rawMessageData" to mapOf(
                "messages" to listOf(
                    mapOf("content" to unsignedHash),
                    mapOf("content" to unsignedHash, "bip44change" to CHIMERIC_INDEX)
                )
            )
        )

        // Create the transaction request
        val transactionRequest = TransactionRequest()
            .operation(TransactionOperation.RAW)
            .source(SourceTransferPeerPath().type(TransferPeerPathType.VAULT_ACCOUNT).id(vaultAccount))
            .assetId(assetID)
            .note("Signing transaction")
            .extraParameters(extraParameters)

        return try {
            // Create the transaction asynchronously
            val transactionFuture: CompletableFuture<ApiResponse<CreateTransactionResponse>> =
                fireblocks.transactions().createTransaction(transactionRequest, null, idempotencyKey)

            // Block and get the transaction response
            val transactionResponse = transactionFuture.get(30, TimeUnit.SECONDS) // Adjust timeout as needed

            // Extract the transaction ID
            val txId = transactionResponse.data?.id
                ?: throw IllegalStateException("Transaction ID is undefined.")

            // Wait for transaction completion
            val txInfo = waitForTransactionCompletion(txId, fireblocks)

            // Extract and return the signed messages
            txInfo.signedMessages?.map { signedMessage ->
                mapOf(
                    "publicKey" to signedMessage.publicKey,
                    "signature" to (signedMessage.signature?.fullSig ?: "")
                )
            }
        } catch (ex: Exception) {
            println("Error signing transaction: ${ex.message}")
            null
        }
    }

    fun waitForTransactionCompletion(txId: String, fireblocks: Fireblocks): TransactionResponse {
        val maxRetries = 60 // Set a maximum number of retries to avoid infinite looping
        val retryInterval = 1000L // 1 second in milliseconds

        var retries = 0

        while (retries < maxRetries) {
            try {
                // Use the asynchronous getTransaction method
                val transactionFuture = fireblocks.transactions().getTransaction(txId)
                val transactionResponse = transactionFuture.get(5, TimeUnit.SECONDS) // Timeout for each response

                // Check if the transaction is completed
                if (transactionResponse.data?.status == "COMPLETED") {
                    return transactionResponse.data
                }

                println("Transaction status: ${transactionResponse.data?.status}")

            } catch (e: Exception) {
                println("Error while fetching transaction status: ${e.message}")
            }

            Thread.sleep(retryInterval)
            retries++
        }

        throw IllegalStateException("Transaction did not complete within the maximum retries.")
    }


    fun createTxWithSigns(
        transactionBodyHex: String,
        signedMessages: List<Map<String, String>>
    ): String {
        // Decode the hex-encoded transaction body into bytes
        val transactionBodyBytes = HexUtil.decodeHexString(transactionBodyHex)

        // Decode the CBOR bytes into a CBOR Map
        val cborDataItems: List<DataItem> = CborDecoder.decode(transactionBodyBytes)
        if (cborDataItems.isEmpty() || cborDataItems[0] !is CborMap) {
            throw IllegalArgumentException("Invalid transaction body: not a valid CBOR Map")
        }
        val cborMap = cborDataItems[0] as CborMap

        // Deserialize the CBOR Map into a TransactionBody
        val transactionBody = TransactionBody.deserialize(cborMap)

        // Create a TransactionWitnessSet
        val witnessSet = TransactionWitnessSet()
        val vkeyWitnesses = mutableListOf<VkeyWitness>()

        // Iterate over signed messages to create VkeyWitnesses
        signedMessages.forEach { signedMessage ->
            val pubKeyHex = signedMessage["publicKey"]
            val signatureHex = signedMessage["signature"]

            if (pubKeyHex != null && signatureHex != null) {
                // Create a VkeyWitness using the public key and signature
                val vkeyWitness = VkeyWitness(
                    HexUtil.decodeHexString(pubKeyHex),
                    HexUtil.decodeHexString(signatureHex)
                )
                vkeyWitnesses.add(vkeyWitness)
            } else {
                throw IllegalArgumentException("Signed message must contain 'publicKey' and 'signature'")
            }
        }

        // Add the VkeyWitnesses to the TransactionWitnessSet
        witnessSet.vkeyWitnesses = vkeyWitnesses

        // Create the signed Transaction
        val signedTransaction = Transaction(transactionBody, witnessSet, true, null)

        // Serialize the signed transaction and return it as a hex string
        return HexUtil.encodeHexString(signedTransaction.serialize())
    }


    private fun blake2bHash(data: ByteArray, digestSize: Int = 32): ByteArray {
        val digest = Blake2bDigest(digestSize * 8)
        digest.update(data, 0, data.size)
        val output = ByteArray(digest.digestSize)
        digest.doFinal(output, 0)
        return output
    }

    private fun String.hexStringToByteArray(): ByteArray {
        val sanitized = this.filter { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }
        return ByteArray(sanitized.length / 2) {
            Integer.parseInt(sanitized.substring(it * 2, it * 2 + 2), 16).toByte()
        }
    }
}

fun main() {
    val service = CardanoStakingService()

    // Call the stake intent function
    try {
        val unsignedTransaction =
            service.createStakeIntent("addr_test1qplvphyepcs7e3enc4de3ylvj2ururkhy49clr2k27gtqky24wqtjsp5h0udjxm3d8n2f5wh33v2vm4cwtr8grvk7xmsfdhfsk")
        println("Unsigned Transaction: $unsignedTransaction")

        val transactionHash = service.decodeAndHashTransaction(unsignedTransaction)
        println("Transaction Hash: $transactionHash")

        // Sign the transaction to get public keys and signatures
        val signedTx = service.signTx(unsignedTransaction, "1", "ADA_TEST")
        println("Signed Transaction: $signedTx")

        if (signedTx != null) {
            // Combine the unsigned transaction with the signatures
            val mergedSignedTransaction = service.createTxWithSigns(unsignedTransaction, signedTx)
            println("Merged Signed Transaction: $mergedSignedTransaction")
            // Take the mergedSignedTransaction and then broadcast to our API - https://docs.blockdaemon.com/reference/submittransaction
        } else {
            println("Error: Failed to generate signed transaction")
        }
    } catch (e: Exception) {
        println("Error: ${e.message}")
    }
}


