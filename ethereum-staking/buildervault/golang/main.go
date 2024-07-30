package main

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"gitlab.com/Blockdaemon/go-tsm-sdkv2/ec"
	"gitlab.com/Blockdaemon/go-tsm-sdkv2/tsm" // Builder Vault MPC SDK for wallet management
	"gitlab.com/Blockdaemon/go-tsm-sdkv2/tsm/tsmutils"
	"golang.org/x/sync/errgroup"

	"github.com/fatih/structs"
	"github.com/joho/godotenv"
)

type Stake struct {
	WithdrawalAddress string `json:"withdrawal_address"`
	Amount            string `json:"amount"`
	FeeRecipient      string `json:"fee_recipient"`
}

type Request struct {
	Stakes []Stake `json:"stakes"`
}

type Response struct {
	StakeIntentID string `json:"stake_intent_id"`
	Ethereum      struct {
		Stakes []struct {
			StakeID               string `json:"stake_id"`
			Amount                string `json:"amount"`
			ValidatorPublicKey    string `json:"validator_public_key"`
			WithdrawalCredentials string `json:"withdrawal_credentials"`
		} `json:"stakes"`
		ContractAddress     string `json:"contract_address"`
		UnsignedTransaction string `json:"unsigned_transaction"`
	} `json:"ethereum"`
}

// The BuilderVault MPC public keys of the players used to encrypt MPC protocol data end-to-end
var playerB64Pubkeys = []string{
	"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtDFBfanInAMHNKKDG2RW/DiSnYeI7scVvfHIwUIRdbPH0gBrsilqxlvsKZTakN8om/Psc6igO+224X8T0J9eMg==",
	"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqvSkhonTeNhlETse8v3X7g4p100EW9xIqg4aRpD8yDXgB0UYjhd+gFtOCsRT2lRhuqNForqqC+YnBsJeZ4ANxg==",
}

func main() {

	// Read environment variables and load .env file
	err := godotenv.Load()
	if err != nil {
		fmt.Println("Error loading .env file")
		os.Exit(1)
	}

	apiKey := strings.TrimSpace(os.Getenv("BLOCKDAEMON_API_KEY"))
	if apiKey == "" {
		fmt.Println("BLOCKDAEMON_API_KEY environment variable not set")
		os.Exit(1)
	}

	stakeApiKey := strings.TrimSpace(os.Getenv("BLOCKDAEMON_STAKE_API_KEY"))
	if stakeApiKey == "" {
		fmt.Println("BLOCKDAEMON_STAKE_API_KEY environment variable not set")
		os.Exit(1)
	}

	ethereumNetwork := strings.TrimSpace(os.Getenv("ETHEREUM_NETWORK"))
	if ethereumNetwork == "" {
		fmt.Println("ETHEREUM_NETWORK environment variable not set")
		os.Exit(1)
	}

	ethereumWithdrawalAddress := strings.TrimSpace(os.Getenv("ETHEREUM_WITHDRAWAL_ADDRESS"))
	if ethereumWithdrawalAddress == "" {
		fmt.Println("ETHEREUM_WITHDRAWAL_ADDRESS environment variable not set")
		os.Exit(1)
	}

	stakeAmountGweiStr := "32000000000" // 32ETH denominated in Gwei

	// * BuilderVault mTLS authentication with publickey pinning: https://builder-vault-tsm.docs.blockdaemon.com/docs/authentication-3#public-key-pinning

	// The TLS public keys of MPC nodes
	var serverMtlsPublicKeys = map[int]string{
		0: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaWLFxRxgLQHJ662gcd2LfPFYKDmI\n8AlzFUu/MFR0Pb5d0JYSBL/HAUR5/1OXfEV18riJZJCeOa1gxNocwzqZ9Q==\n-----END PUBLIC KEY-----\n",
		1: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErPzIZwRgiFpBgIDYCzfRxEgvasus\nHa4qlwWnJ0TnlGgjcfD5Bp40J9HnOdlBkzhtVWq5PiLEMaFWdApTkRBT9Q==\n-----END PUBLIC KEY-----\n",
	}

	// Decode server public keys to bytes for use in TLS client authentication
	serverPKIXPublicKeys := make([][]byte, len(serverMtlsPublicKeys))
	for i := range serverMtlsPublicKeys {
		block, rest := pem.Decode([]byte(serverMtlsPublicKeys[i]))
		if block == nil || len(rest) != 0 {
			panic("error decoding server public key (no block data)")
		}
		serverPublicKey, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			panic(err)
		}
		serverPKIXPublicKeys[i], err = x509.MarshalPKIXPublicKey(serverPublicKey)
		if err != nil {
			panic(err)
		}
	}

	// Create TSM SDK clients with mTLS authentication and public keys
	clients := make([]*tsm.Client, len(serverMtlsPublicKeys))
	for i := range clients {
		config, err := tsm.Configuration{URL: fmt.Sprintf("https://tsm-sandbox.prd.wallet.blockdaemon.app:%v", 8080+i)}.WithMTLSAuthentication("./client.key", "./client.crt", serverPKIXPublicKeys[i])
		if err != nil {
			panic(err)
		}
		clients[i], err = tsm.NewClient(config)
		if err != nil {
			panic(err)
		}
	}

	threshold := 1 // * The security threshold for this key https://builder-vault-tsm.docs.blockdaemon.com/docs/security-overview#security-model

	masterKeyID := getKeyID(clients, threshold, "key.txt")

	// Get the public key for the derived key m/44/60

	chainPath := []uint32{44, 60}
	pkixPublicKeys := make([][]byte, len(clients))
	for i, client := range clients {
		var err error
		pkixPublicKeys[i], err = client.ECDSA().PublicKey(context.TODO(), masterKeyID, chainPath)
		if err != nil {
			panic(err)
		}
	}

	// Validate public keys

	for i := 1; i < len(pkixPublicKeys); i++ {
		if bytes.Compare(pkixPublicKeys[0], pkixPublicKeys[i]) != 0 {
			panic("public keys do not match")
		}
	}
	pkixPublicKey := pkixPublicKeys[0]

	// Convert the public key into an Ethereum address

	publicKeyBytes, err := tsmutils.PKIXPublicKeyToUncompressedPoint(pkixPublicKey)
	if err != nil {
		panic(err)
	}

	ecdsaPub, err := crypto.UnmarshalPubkey(publicKeyBytes)
	if err != nil {
		panic(err)
	}

	address := crypto.PubkeyToAddress(*ecdsaPub)
	fmt.Println("Ethereum address of derived key m/44/60:", address)

	// * Using Blockdaemon RPC API for Ethereum: https://docs.blockdaemon.com/reference/how-to-access-ethereum-api
	// Initialize go-ethereum client

	ethereumNodeURL := fmt.Sprintf("https://svc.blockdaemon.com/ethereum/%s/native?apiKey=%s", ethereumNetwork, apiKey)
	ethClient, err := ethclient.Dial(ethereumNodeURL)
	if err != nil {
		panic(err)
	}

	// Define stake intent request
	stakeRequest := &Request{
		Stakes: []Stake{
			{
				Amount:            stakeAmountGweiStr,
				WithdrawalAddress: ethereumWithdrawalAddress,
				FeeRecipient:      ethereumWithdrawalAddress,
			},
		},
	}

	// Check balance at m/42/5

	balance, err := ethClient.BalanceAt(context.TODO(), address, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println("Balance at account m/44/60", address, ":", balance, "Wei")

	// convert Gwei String to Wei BigInt

	stakeAmountWeiStr := stakeAmountGweiStr + "000000000"
	stakeAmountWeiInt, ok := new(big.Int).SetString(stakeAmountWeiStr, 10)
	if !ok {
		panic("error converting amountWeiStr to big.Int")
	}
	if stakeAmountWeiInt.Cmp(balance) > 0 {
		fmt.Println()
		fmt.Println("Insufficient funds.")
		fmt.Println("Insert additional funds at address", address, ", e.g. by visiting https://holesky-faucet.pk910.de")
		fmt.Println("Then run this program again.")
		os.Exit(0)
	}

	// Create stake intent and receive transaction data
	txData, contractAddress, totalAmount := createStakeIntent(stakeApiKey, stakeRequest, ethereumNetwork)

	// Craft transaction with stake intent unsigned tx data and blockchain inputs
	unsignedTx, unsignedTxHash, chainID := craftTx(ethClient, address, contractAddress, totalAmount, txData)

	// Sign the transaction with MPC wallet private key shares
	signature := signTx(unsignedTxHash, clients, masterKeyID, chainPath)

	// Broadcast the transaction to the blockchain
	txHash := sendTx(ethClient, chainID, unsignedTx, signature)
	fmt.Printf("\nBroadcasted transaction hash: https://%s.etherscan.io/tx/%s\n", ethereumNetwork, txHash)
}

func createStakeIntent(stakeApiKey string, stakeRequest *Request, ethereumNetwork string) (string, string, *big.Int) {

	// * Create a stake intent with the Staking Integration API: https://docs.blockdaemon.com/reference/postethereumstakeintent

	requestJson, _ := json.Marshal(stakeRequest)

	fmt.Println("\nStake API request:\n", structs.Map(stakeRequest))

	req, _ := http.NewRequest("POST", fmt.Sprintf("https://svc.blockdaemon.com/boss/v1/ethereum/%s/stake-intents", ethereumNetwork), bytes.NewBuffer(requestJson))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", stakeApiKey)
	//req.Header.Set("Idempotency-Key", "DA5C8D68-9283-4D57-9EF0-1A9F33DC8E70")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal("Failed to send request:", err)
	}
	if resp.StatusCode != 200 {
		log.Fatal("HTTP request ", resp.StatusCode, " error:", http.StatusText(resp.StatusCode))
	}

	defer resp.Body.Close()

	var stakeResponse Response
	json.NewDecoder(resp.Body).Decode(&stakeResponse)

	stakes := stakeResponse.Ethereum.Stakes
	totalAmount := new(big.Int)
	for _, stake := range stakes {
		amount, _ := new(big.Int).SetString(stake.Amount, 10)
		amount = amount.Mul(amount, new(big.Int).SetInt64(1000000000))
		totalAmount.Add(totalAmount, amount)
	}
	fmt.Println("\nStake API response:\n", structs.Map(stakeResponse))

	return stakeResponse.Ethereum.UnsignedTransaction, stakeResponse.Ethereum.ContractAddress, totalAmount
}

func craftTx(client *ethclient.Client, address common.Address, contractAddress string, totalAmount *big.Int, txData string) (*types.Transaction, []byte, *big.Int) {
	nonce, _ := client.PendingNonceAt(context.Background(), address)
	gasPrice, _ := client.SuggestGasPrice(context.Background())
	chainID, _ := client.ChainID(context.Background())
	gasTipCap, _ := client.SuggestGasTipCap(context.TODO())
	gasFeeCap, _ := client.SuggestGasPrice(context.TODO())

	decodedContactAddress := common.HexToAddress(contractAddress)

	callMsg := ethereum.CallMsg{
		From:     address,
		To:       &decodedContactAddress,
		GasPrice: gasPrice,
		Value:    totalAmount,
		Data:     common.FromHex(txData),
	}

	gasLimit, err := client.EstimateGas(context.Background(), callMsg)
	if err != nil {
		log.Fatal(err)
	}

	unsignedTx := types.NewTx(&types.DynamicFeeTx{
		ChainID:   chainID,
		Nonce:     nonce,
		To:        &decodedContactAddress,
		Value:     totalAmount,
		Gas:       gasLimit,
		GasTipCap: gasTipCap,
		GasFeeCap: gasFeeCap,
		Data:      common.FromHex(txData),
	})

	fmt.Println("\nCrafted unsigned transaction values:\n", "Nonce:", unsignedTx.Nonce(), "\n GasFeeCap:", unsignedTx.GasFeeCap(), "\n Gas:", unsignedTx.Gas(), "\n To:", unsignedTx.To().String(), "\n Value amount:", unsignedTx.Value(), "\n Hash:", unsignedTx.Hash())

	raw, err := unsignedTx.MarshalBinary()
	if err != nil {
		panic(err)
	}
	fmt.Printf("\nCrafted unsigned transaction (hex encoded): 0x%x\n", raw)

	// create a NewCancunSigner for EIP 1559 transactions
	signer := types.NewCancunSigner(chainID)

	return unsignedTx, signer.Hash(unsignedTx).Bytes(), chainID
}

func signTx(unsignedTxHash []byte, clients []*tsm.Client, masterKeyID string, chainPath []uint32) []byte {

	fmt.Println("Signing transaction hash using Builder Vault...")

	playerPubkeys := map[int][]byte{}
	playerIds := []int{0, 1}
	// iterate over other players public keys and convert them
	for i := range playerIds {
		pubkey, err := base64.StdEncoding.DecodeString(playerB64Pubkeys[i])
		if err != nil {
			panic(err)
		}
		playerPubkeys[playerIds[i]] = pubkey
	}
	//signPlayers := []int{1, 2}
	signSessionConfig := tsm.NewSessionConfig(tsm.GenerateSessionID(), playerIds, playerPubkeys)

	partialSignaturesLock := sync.Mutex{}
	var partialSignatures [][]byte
	ctx := context.Background()
	var eg errgroup.Group
	for _, client := range clients {
		client := client
		eg.Go(func() error {
			partialSignResult, err := client.ECDSA().Sign(ctx, signSessionConfig, masterKeyID, chainPath, unsignedTxHash)
			if err != nil {
				return err
			}
			partialSignaturesLock.Lock()
			partialSignatures = append(partialSignatures, partialSignResult.PartialSignature)
			partialSignaturesLock.Unlock()
			return nil
		})
	}

	if err := eg.Wait(); err != nil {
		panic(err)
	}

	signature, err := tsm.ECDSAFinalizeSignature(unsignedTxHash, partialSignatures)
	if err != nil {
		panic(err)
	}

	// Construct Ethereum R S V signature format

	sigBytes := make([]byte, 2*32+1)
	copy(sigBytes[0:32], signature.R())
	copy(sigBytes[32:64], signature.S())
	sigBytes[64] = byte(signature.RecoveryID())
	fmt.Println("\nTransaction signature (hex encoded):\n", hex.EncodeToString(sigBytes))

	return sigBytes
}

func sendTx(client *ethclient.Client, chainID *big.Int, unsignedTx *types.Transaction, sigBytes []byte) string {

	signedTx, err := unsignedTx.WithSignature(types.NewCancunSigner(chainID), sigBytes)
	if err != nil {
		panic(err)
	}

	raw, err := signedTx.MarshalBinary()
	if err != nil {
		panic(err)
	}
	fmt.Printf("\nSigned raw serialized transaction: 0x%x\n", raw)

	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		log.Fatal(err)
	}

	return signedTx.Hash().Hex()
}

func getKeyID(clients []*tsm.Client, threshold int, keyFile string) (keyID string) {

	// Read existing or generate a new ECDSA master key

	keyIDBytes, err := os.ReadFile(keyFile)
	if err == nil {
		keyID = strings.TrimSpace(string(keyIDBytes))
		fmt.Println("Read key with ID", keyID, "from file", keyFile)
		return keyID
	}

	if !errors.Is(err, os.ErrNotExist) {
		panic(err)
	}

	// * Generate an ECDSA master key: https://builder-vault-tsm.docs.blockdaemon.com/docs/getting-started-demo-tsm-golang
	playerPubkeys := map[int][]byte{}
	playerIds := []int{0, 1}
	// iterate over other players public keys and convert them
	for i := range playerIds {
		pubkey, err := base64.StdEncoding.DecodeString(playerB64Pubkeys[i])
		if err != nil {
			panic(err)
		}
		playerPubkeys[playerIds[i]] = pubkey
	}

	keyGenPlayers := []int{0, 1}
	sessionConfig := tsm.NewSessionConfig(tsm.GenerateSessionID(), keyGenPlayers, playerPubkeys)
	//sessionConfig := tsm.NewStaticSessionConfig(tsm.GenerateSessionID(), len(clients))
	ctx := context.TODO()
	masterKeyIDs := make([]string, len(clients))
	var eg errgroup.Group
	for i, client := range clients {
		client, i := client, i
		eg.Go(func() error {
			var err error
			masterKeyIDs[i], err = client.ECDSA().GenerateKey(ctx, sessionConfig, threshold, ec.Secp256k1.Name(), "")
			return err
		})
	}
	if err := eg.Wait(); err != nil {
		panic(err)
	}

	for i := 1; i < len(masterKeyIDs); i++ {
		if masterKeyIDs[0] != masterKeyIDs[i] {
			panic("key IDs do not match")
		}
	}
	keyID = masterKeyIDs[0]

	fmt.Println("Generated master key (m) with ID", keyID, "; saving to file", keyFile)

	err = os.WriteFile(keyFile, []byte(keyID+"\n"), 0644)
	if err != nil {
		panic(err)
	}

	return keyID

}
