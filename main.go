package main

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"gitlab.com/Blockdaemon/go-tsm-sdkv2/tsm"
	"golang.org/x/sync/errgroup"
)

var gwei = new(big.Int).Exp(big.NewInt(10), big.NewInt(9), nil)

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

// ! Create stake intent
func createStakeIntent(stakeApiKey string, stakeRequest *Request) (string, string, *big.Int) {
	requestJson, _ := json.Marshal(stakeRequest)
	fmt.Println("Stake request json:", stakeRequest)

	req, _ := http.NewRequest("POST", "https://svc.blockdaemon.com/boss/v1/ethereum/holesky/stake-intents", bytes.NewBuffer(requestJson))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", stakeApiKey)

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
		totalAmount.Add(totalAmount, amount)
	}

	return stakeResponse.Ethereum.UnsignedTransaction, stakeResponse.Ethereum.ContractAddress, totalAmount
}

// ! Craft transaction
func craftTx(client *ethclient.Client, ethereumSenderAddress string, contractAddress string, totalAmount *big.Int, txData string) (*types.Transaction, *big.Int) {
	nonce, err := client.PendingNonceAt(context.Background(), common.HexToAddress(ethereumSenderAddress))
	if err != nil {
		log.Fatal(err)
	}

	gasPrice, err := client.SuggestGasPrice(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	chainID, err := client.ChainID(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	decodedContactAddress := common.HexToAddress(contractAddress)

	msg := ethereum.CallMsg{
		From:     common.HexToAddress(ethereumSenderAddress),
		To:       &decodedContactAddress,
		GasPrice: gasPrice,
		Value:    totalAmount,
		Data:     common.Hex2Bytes(txData),
	}
	gasLimit, err := client.EstimateGas(context.Background(), msg)
	if err != nil {
		log.Fatal(err)
	}

	unsignedTx := types.NewTx(&types.DynamicFeeTx{
		ChainID: chainID,
		Nonce:   nonce,
		To:      &decodedContactAddress,
		Value:   totalAmount,
		Gas:     gasLimit,
		Data:    common.Hex2Bytes(txData),
	})

	return unsignedTx, chainID
}

// ! Sign transaction
func signTx(unsignedTx *types.Transaction) []byte {

	// Builder Vault server TLS public keys (self-signed)
	var serverMtlsPublicKeys = map[int]string{
		0: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaWLFxRxgLQHJ662gcd2LfPFYKDmI\n8AlzFUu/MFR0Pb5d0JYSBL/HAUR5/1OXfEV18riJZJCeOa1gxNocwzqZ9Q==\n-----END PUBLIC KEY-----\n",
		1: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErPzIZwRgiFpBgIDYCzfRxEgvasus\nHa4qlwWnJ0TnlGgjcfD5Bp40J9HnOdlBkzhtVWq5PiLEMaFWdApTkRBT9Q==\n-----END PUBLIC KEY-----\n",
		2: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyaLwUY4A99EDvqGMjBT2Q/M3zydm\nOniFOZicnwdvnJTMgXw8LAqLee+0VFIUZbxRPTvN1c1ORoD8+2xJ0VPglg==\n-----END PUBLIC KEY-----\n",
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

	// Create TSM SDK clients with mTLS authentication and public key pinning
	clients := make([]*tsm.Client, len(serverMtlsPublicKeys))
	for i := range clients {
		config, err := tsm.Configuration{URL: fmt.Sprintf("https://tsm-sandbox.prd.wallet.blockdaemon.app:%v", 8080+i)}.WithMTLSAuthentication("../client.key", "../client.crt", serverPKIXPublicKeys[i])
		if err != nil {
			panic(err)
		}
		clients[i], err = tsm.NewClient(config)
		if err != nil {
			panic(err)
		}
	}

	// The public keys of the other players to encrypt MPC protocol data end-to-end
	playerB64Pubkeys := []string{
		"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtDFBfanInAMHNKKDG2RW/DiSnYeI7scVvfHIwUIRdbPH0gBrsilqxlvsKZTakN8om/Psc6igO+224X8T0J9eMg==",
		"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqvSkhonTeNhlETse8v3X7g4p100EW9xIqg4aRpD8yDXgB0UYjhd+gFtOCsRT2lRhuqNForqqC+YnBsJeZ4ANxg==",
		"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBaHCIiViexaVaPuER4tE6oJE3IBA0U//GlB51C1kXkT07liVc51uWuYk78wi4e1unxC95QbeIfnDCG2i43fW3g==",
	}

	playerPubkeys := map[int][]byte{}
	playerIds := []int{0, 1, 2}
	// iterate over other players public keys and convert them
	for i := range playerIds {
		pubkey, err := base64.StdEncoding.DecodeString(playerB64Pubkeys[i])
		if err != nil {
			panic(err)
		}
		playerPubkeys[playerIds[i]] = pubkey
	}

	// Use the TSM to sign via the existing derived key for chain m/44/1
	masterKeyID := "JWEcnWmbdncdBOCpMyRW4EldUZyL"
	chainPath := []uint32{44, 551, 0, 0}

	partialSignaturesLock := sync.Mutex{}
	partialSignatures := make([][]byte, 0)
	//sessionConfig := tsm.NewStaticSessionConfig(tsm.GenerateSessionID(),3)
	Players := []int{0, 1, 2}
	sessionConfig := tsm.NewSessionConfig(tsm.GenerateSessionID(), Players, playerPubkeys)
	ctx := context.Background()
	var eg errgroup.Group
	for _, client := range clients {
		client := client
		eg.Go(func() error {
			partialSignResult, err := client.ECDSA().Sign(ctx, sessionConfig, masterKeyID, chainPath, unsignedTx.Hash().Bytes())
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

	signature, err := tsm.ECDSAFinalizeSignature(unsignedTx.Hash().Bytes(), partialSignatures)
	if err != nil {
		panic(err)
	}

	// Add signature to transaction

	sigBytes := make([]byte, 2*32+1)
	copy(sigBytes[0:32], signature.R())
	copy(sigBytes[32:64], signature.S())
	sigBytes[64] = byte(signature.RecoveryID())
	fmt.Println("Signed transaction:", sigBytes)

	return sigBytes
}

// ! Broadcast stake deposit to chain
func sendTx(client *ethclient.Client, chainID *big.Int, unsignedTx *types.Transaction, sigBytes []byte) string {

	signedTx, err := unsignedTx.WithSignature(types.NewEIP155Signer(chainID), sigBytes)
	if err != nil {
		panic(err)
	}

	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		log.Fatal(err)
	}

	return signedTx.Hash().Hex()
}

func main() {
	stakeApiKey := os.Getenv("STAKE_API_KEY")
	rpcApiKey := os.Getenv("RPC_API_KEY")
	ethereumSenderAddress := "0x5C7168F2D1243A75B5970a9d0bBDBDFD8836eb2f" // Set your Ethereum sender address here. E.g. "0x71Bff5FFeF6408dAe06c055caB770D76E04831d2"
	stakeWithdrawalAddress := "0x5C7168F2D1243A75B5970a9d0bBDBDFD8836eb2f"
	stakeFeeRecipientAddress := "0x5C7168F2D1243A75B5970a9d0bBDBDFD8836eb2f"

	// Create go-ethereum/rpc client with heaader-based authentication
	rpcClient, err := rpc.Dial("https://svc.blockdaemon.com/ethereum/holesky/native")
	if err != nil {
		log.Fatal("Failed to connect to the Ethereum client:", err)
	}
	rpcClient.SetHeader("X-API-KEY", rpcApiKey)
	client := ethclient.NewClient(rpcClient)

	// Check balance available for staking
	balance, err := client.BalanceAt(context.Background(), common.HexToAddress(ethereumSenderAddress), nil)
	if err != nil {
		panic(err)
	}
	fmt.Println("Balance at account:", ethereumSenderAddress, "=", balance.Int64(), "wei")

	// Define stake intent request: 1x32ETH
	stakeRequest := &Request{
		Stakes: []Stake{
			{
				Amount:            "32000000000", // denominated in Gwei
				WithdrawalAddress: stakeWithdrawalAddress,
				FeeRecipient:      stakeFeeRecipientAddress,
			},
		},
	}

	txData, contractAddress, totalAmount := createStakeIntent(stakeApiKey, stakeRequest)
	totalAmount.Mul(totalAmount, gwei)

	unsignedTx, chainID := craftTx(client, ethereumSenderAddress, contractAddress, totalAmount, txData)
	signature := signTx(unsignedTx)
	txHash := sendTx(client, chainID, unsignedTx, signature)

	fmt.Println(txHash)
}
