package main

import (
	"bytes"
	"context"
	"encoding/json"
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
	"gitlab.com/Blockdaemon/go-tsm-sdkv2/tsm" // Builder Vault MPC SDK for wallet management
	"golang.org/x/sync/errgroup"

	"github.com/fatih/structs"
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

// ! Create stake intent
func createStakeIntent(stakeApiKey string, stakeRequest *Request) (string, string, *big.Int) {
	requestJson, _ := json.Marshal(stakeRequest)

	fmt.Println("\nStake request:\n", structs.Map(stakeRequest))

	req, _ := http.NewRequest("POST", "https://svc.blockdaemon.com/boss/v1/ethereum/holesky/stake-intents", bytes.NewBuffer(requestJson))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", stakeApiKey)
	//req.Header.Set("Idempotency-Key", "E96E9CE5-A81E-4178-AAA7-4BDC7ED1BCC2")

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
	fmt.Println("\nStake response:\n", structs.Map(stakeResponse))

	return stakeResponse.Ethereum.UnsignedTransaction, stakeResponse.Ethereum.ContractAddress, totalAmount
}

// ! Craft transaction
func craftTx(client *ethclient.Client, ethereumSenderAddress string, contractAddress string, totalAmount *big.Int, txData string) (*types.Transaction, []byte, *big.Int) {
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
		Data:     common.FromHex(txData),
	}

	gasLimit, err := client.EstimateGas(context.Background(), msg)
	if err != nil {
		log.Fatal(err)
	}

	unsignedTx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		To:       &decodedContactAddress,
		Value:    totalAmount,
		Gas:      gasLimit,
		GasPrice: gasPrice,
		Data:     common.FromHex(txData),
	})

	fmt.Println("\nCrafted unsigned transaction:\n", "Nonce:", unsignedTx.Nonce(), "\n GasPrice:", unsignedTx.GasPrice(), "\n Gas:", unsignedTx.Gas(), "\n To:", unsignedTx.To().String(), "\n Value:", unsignedTx.Value())

	signer := types.NewEIP155Signer(chainID)

	return unsignedTx, signer.Hash(unsignedTx).Bytes(), chainID
}

// ! Sign transaction
func signTx(unsignedTxHash []byte) []byte {
	// Create clients for each of the nodes

	configs := []*tsm.Configuration{
		tsm.Configuration{URL: "https://node-1-prod.tsm-test-greg.dev.wallet.blockdaemon.app"}.WithAPIKeyAuthentication(os.Getenv("BV_NODE1_KEY")),
		tsm.Configuration{URL: "https://node-2-prod.tsm-test-greg.dev.wallet.blockdaemon.app"}.WithAPIKeyAuthentication(os.Getenv("BV_NODE2_KEY")),
	}

	clients := make([]*tsm.Client, len(configs))
	for i, config := range configs {
		var err error
		if clients[i], err = tsm.NewClient(config); err != nil {
			panic(err)
		}
	}

	// Use the TSM to sign via the existing derived key for chain m/44/60
	keyID := "r6mMzrh85Oel0QvpT0VsXdKJs9A4"
	derivationPath := []uint32{44, 60, 0, 0}

	partialSignaturesLock := sync.Mutex{}
	var partialSignatures [][]byte
	signPlayers := []int{1, 2}
	signSessionConfig := tsm.NewSessionConfig(tsm.GenerateSessionID(), signPlayers, nil)
	ctx := context.Background()
	var eg errgroup.Group
	for _, client := range clients {
		client := client
		eg.Go(func() error {
			partialSignResult, err := client.ECDSA().Sign(ctx, signSessionConfig, keyID, derivationPath, unsignedTxHash)
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

	// Construct Ethereum V R S signature format

	sigBytes := make([]byte, 2*32+1)
	copy(sigBytes[0:32], signature.R())
	copy(sigBytes[32:64], signature.S())
	sigBytes[64] = byte(signature.RecoveryID())
	fmt.Println("\nTransaction signature:\n", sigBytes)

	return sigBytes
}

// ! Broadcast stake deposit to chain
func sendTx(client *ethclient.Client, chainID *big.Int, unsignedTx *types.Transaction, sigBytes []byte) string {

	signedTx, err := unsignedTx.WithSignature(types.NewEIP155Signer(chainID), sigBytes)
	if err != nil {
		panic(err)
	}
	fmt.Println("\nSigned raw transaction:\n", signedTx.Data())

	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		log.Fatal(err)
	}

	return signedTx.Hash().Hex()
}

func main() {
	stakeApiKey := os.Getenv("STAKE_API_KEY")
	rpcApiKey := os.Getenv("RPC_API_KEY")

	// Define stake intent parameters
	ethereumSenderAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"
	stakeWithdrawalAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"
	stakeFeeRecipientAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"

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

	// Create go-ethereum/rpc client with header-based authentication
	rpcClient, err := rpc.Dial("https://svc.blockdaemon.com/ethereum/holesky/native")
	if err != nil {
		log.Fatal("Failed to connect to the Ethereum client:", err)
	}
	rpcClient.SetHeader("X-API-KEY", rpcApiKey)
	client := ethclient.NewClient(rpcClient)

	// Check sender wallet balance available for staking
	balance, err := client.BalanceAt(context.Background(), common.HexToAddress(ethereumSenderAddress), nil)
	if err != nil {
		panic(err)
	}
	fmt.Println("Balance at account:", ethereumSenderAddress, "=", (balance), "wei")

	// Create stake intent nd receive transaction data
	txData, contractAddress, totalAmount := createStakeIntent(stakeApiKey, stakeRequest)

	// Craft transaction with stake intent unsigned tx data and blockchain inputs
	unsignedTx, unsignedTxHash, chainID := craftTx(client, ethereumSenderAddress, contractAddress, totalAmount, txData)

	// Sign the transaction with MPC wallet private key shares
	signature := signTx(unsignedTxHash)

	// Broadcast the transaction to the blockchain
	txHash := sendTx(client, chainID, unsignedTx, signature)
	fmt.Println("\nTransaction hash:", txHash)
}
