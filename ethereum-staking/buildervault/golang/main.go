package main

import (
	"bytes"
	"context"
	"encoding/hex"
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

	fmt.Println("\nStake API request:\n", structs.Map(stakeRequest))

	req, _ := http.NewRequest("POST", "https://svc.blockdaemon.com/boss/v1/ethereum/holesky/stake-intents", bytes.NewBuffer(requestJson))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", stakeApiKey)
	//req.Header.Set("Idempotency-Key", "45C8C466-6EC6-4C8F-9C88-7B928AFF9A5F")

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

	unsignedTx := types.NewTx(&types.DynamicFeeTx{
		ChainID:   chainID,
		Nonce:     nonce,
		To:        &decodedContactAddress,
		Value:     totalAmount,
		Gas:       gasLimit,
		GasTipCap: big.NewInt(2 * 1e9),  // 2 Gwei
		GasFeeCap: big.NewInt(40 * 1e9), // 40 Gwei
		Data:      common.FromHex(txData),
	})

	fmt.Println("\nCrafted unsigned transaction values:\n", "Nonce:", unsignedTx.Nonce(), "\n GasFeeCap:", unsignedTx.GasFeeCap(), "\n Gas:", unsignedTx.Gas(), "\n To:", unsignedTx.To().String(), "\n Value amount:", unsignedTx.Value(), "\n Hash:", unsignedTx.Hash())

	raw, err := unsignedTx.MarshalBinary()
	if err != nil {
		panic(err)
	}
	fmt.Printf("\nCrafted unsigned transaction (hex encoded): 0x%x", raw)

	// create a NewLondonSigner for EIP 1559 transactions
	signer := types.NewLondonSigner(chainID)

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

	// Construct Ethereum R S V signature format

	sigBytes := make([]byte, 2*32+1)
	copy(sigBytes[0:32], signature.R())
	copy(sigBytes[32:64], signature.S())
	sigBytes[64] = byte(signature.RecoveryID())
	fmt.Println("\n\nTransaction signature (hex encoded):\n", hex.EncodeToString(sigBytes))

	return sigBytes
}

// ! Broadcast stake deposit to chain
func sendTx(client *ethclient.Client, chainID *big.Int, unsignedTx *types.Transaction, sigBytes []byte) string {

	signedTx, err := unsignedTx.WithSignature(types.NewLondonSigner(chainID), sigBytes)
	if err != nil {
		panic(err)
	}

	raw, err := signedTx.MarshalBinary()
	if err != nil {
		panic(err)
	}
	fmt.Printf("\nSigned raw transaction (RLP encoded): 0x%x", raw)

	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		log.Fatal(err)
	}

	return signedTx.Hash().Hex()
}

func main() {
	stakeApiKey := os.Getenv("STAKE_API_KEY")
	rpcApiKey := os.Getenv("RPC_API_KEY")

	// ! Define stake intent parameters
	ethereumSenderAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"
	stakeWithdrawalAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"
	stakeFeeRecipientAddress := "0xE8fE1C1058b34d5152f2B23908dD8c65715F2D3A"
	stakeAmount := "32000000000" // denominated in Gwei

	// Define stake intent request
	stakeRequest := &Request{
		Stakes: []Stake{
			{
				Amount:            stakeAmount,
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

	// ! Create stake intent and receive transaction data
	txData, contractAddress, totalAmount := createStakeIntent(stakeApiKey, stakeRequest)

	// ! Craft transaction with stake intent unsigned tx data and blockchain inputs
	unsignedTx, unsignedTxHash, chainID := craftTx(client, ethereumSenderAddress, contractAddress, totalAmount, txData)

	// ! Sign the transaction with MPC wallet private key shares
	signature := signTx(unsignedTxHash)

	// ! Broadcast the transaction to the blockchain
	txHash := sendTx(client, chainID, unsignedTx, signature)
	fmt.Println("\nBroadcasted transaction hash:", txHash)
}
