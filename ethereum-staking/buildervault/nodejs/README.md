
# Ethereum staking on Testnet with Builder Vault wallet

```mermaid
sequenceDiagram
    autonumber
    participant StakeClient as Sample stake<br> client application
    participant StakeAPI as Stake Intent API
    participant Blockchain as Blockchain RPC API
    box Builder Vault
      participant TSM1 as MPC Wallet <br>(private key share 1)
      participant TSM2 as MPC Wallet <br>(private key share 2)
    end

    StakeClient ->> StakeAPI: get StakeIntent unsigned tx data <br>(amount, withdrawal & recipient address)
    StakeClient ->> Blockchain: get blockchain inputs (gas, nonce) for new tx<br>(sender wallet)
    StakeClient ->> StakeClient: construct unsigned tx
    StakeClient ->> TSM1: request signature (unsigned tx)
    TSM1 -->> StakeClient: return partial signature
    StakeClient ->> TSM2: request signature (unsigned tx)
    TSM2 -->> StakeClient: return partial signature
    StakeClient ->> StakeClient: combine partial signatures
    StakeClient ->> Blockchain: broadcast signed tx<br>(signed tx, deposit contract)
```

### Prerequisites
  - [Node.js](https://nodejs.org/en/download/package-manager) or use [code-spaces](https://codespaces.new/Blockdaemon/demo-buildervault-stakingAPI?quickstart=1)
  - Register for a demo Builder Vault tenant: https://www.blockdaemon.com/get-started/builder-vault-sandbox-registration
    - Download SDK bundle provided in registration email (extract authentication certificates)
    - Place Builder Vault authentication certificate key-pair `client.crt` & `client.key` in this nodejs folder
  - Register for free Blockdaemon [RPC API key](https://docs.blockdaemon.com/reference/get-started-rpc#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_API_KEY
  - Register for free Blockdaemon [Staking API key](https://docs.blockdaemon.com/reference/get-started-staking-api#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_STAKE_API_KEY
  - Speak to your CSM about getting credentials to the Blockdaemon nexus.sepior.net repo for the nodejs SDK.

### Step 1. Set environment variables in .env
```shell
cd ethereum-staking/buildervault-wallet/nodejs/
cp .env.example .env
```
- update .env with API keys

### Step 2. Install package dependancies
- replace NEXUS_USERNAME & NEXUS_PASSWORD with credential provided by your CSM
```shell
npm config set @sepior:registry=https://nexus.sepior.net/repository/sepior-nodejs-tsm-sdk-group/
npm config set //nexus.sepior.net/repository/sepior-nodejs-tsm-sdk-group/:username=NEXUS_USERNAME
npm config set //nexus.sepior.net/repository/sepior-nodejs-tsm-sdk-group/:\_password=`echo -n 'NEXUS_PASSWORD' | base64`
npm install
```

### Step 3. Launch ethereum-stake-bv.ts to auto-create the Builder Vault wallet address on first run
```shell
npm run start ethereum-stake-bv.ts
```
- note, on first run this step will fail as the wallet address has no funds
- copy the new Ethereum wallet address and fund the account

### Step 4. Fund the new Ethereum wallet address with 33 ETH using faucets below
  - https://holesky-faucet.pk910.de/#/

### Step 5. Launch ethereum-stake-bv.ts to generate the Stake Intent request, sign the request with BuilderVault and broadcast the transaction
```shell
npm run start ethereum-stake-bv.ts
```
- (optional) decode the raw unsigned transaction to inspect the Blockdaemon provided attributes (https://rawtxdecode.in)
- observe the confirmed transaction through the generated blockexplorer link