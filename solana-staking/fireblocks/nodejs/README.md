
# TypeScript Solana staking with Fireblocks wallet

```mermaid
sequenceDiagram
    autonumber
    participant StakeClient as Sample stake<br> client application
    participant StakeAPI as Stake Intent API
    participant Blockchain as Solana RPC
    participant TSM1 as Fireblocks wallet<br> API

    StakeClient ->> StakeAPI: get StakeIntent unsigned tx data <br>(amount, validator vote account, delegator)
    StakeClient ->> StakeClient: construct unsigned tx
    StakeClient ->> Blockchain: get blockchain inputs (gas fee) for new tx<br>(sender wallet)
    StakeClient ->> Blockchain: check delegator account balance for stake<br>(sender wallet)
    StakeClient ->> TSM1: request signature (unsigned tx hash)
    TSM1 -->> StakeClient: return signature
    StakeClient ->> Blockchain: broadcast full signed tx<br>(signed tx)
```

### Prerequisites
  - [Node.js](https://nodejs.org/en/download/package-manager) or launch in [code-spaces](https://codespaces.new/Blockdaemon/demo-buildervault-stakingAPI?quickstart=1)
  - Create Fireblocks [API and Secret key](https://developers.fireblocks.com/docs/manage-api-keys) for use with the [Fireblocks TypeScript SDK](https://github.com/fireblocks/ts-sdk)
  - Register free Blockdaemon [RPC API key](https://docs.blockdaemon.com/reference/get-started-rpc#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_API_KEY
  - Register free Blockdaemon [Staking API key](https://docs.blockdaemon.com/reference/get-started-staking-api#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_STAKE_API_KEY


### Step 1. Set environment variables in .env
```shell
cd solana-staking/fireblocks/nodejs/
cp .env.example .env
```
- update .env with API keys

### Step 2. Install package dependancies
```shell
npm install
```

### Step 3. Launch solana-stake-fb.ts to auto-create the Builder Vault wallet address on first run
```shell
npm run start solana-stake-fb.ts
```
- note, on first run this step will fail as the wallet address has no funds
- copy the new Solana wallet address and fund the account

### Step 4. Fund the new Solana wallet address with 2 SOL using faucets below
  - https://solfaucet.com
  - https://faucet.triangleplatform.com/solana/testnet
  - https://faucet.quicknode.com/solana/testnet
  - https://solfate.com/faucet

### Step 5. Launch solana-stake-fb.ts to generate the Stake Intent request, sign the request with BuilderVault and broadcast the transaction
```shell
npm run start solana-stake-fb.ts
```
- [optional] view the signed transaction contents with inspector: https://explorer.solana.com/tx/inspector?cluster=testnet
- observe the confirmed transaction through the generated blockexplorer link
