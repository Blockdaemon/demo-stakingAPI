
# TypeScript Ethereum staking with Fireblocks wallet

```mermaid
sequenceDiagram
    autonumber
    participant StakeClient as Sample stake<br> client application
    participant StakeAPI as Stake Intent API

    participant TSM1 as Fireblocks API

    StakeClient ->> StakeAPI: get StakeIntent unsigned tx data <br>(amount, withdrawal & recipient address)
    StakeClient ->> StakeClient: decode calldata with<br>deposit contract ABI
    StakeClient ->> TSM1: register web3.js provider
    StakeClient ->> TSM1: invoke web3 smart contract deposit<br> function<br>(amount, calldata, contract address)

    TSM1 ->> TSM1: sign & broadcast contract execution
```

### Prerequisites
  - [Node.js](https://nodejs.org/en/download/package-manager) or launch in [code-spaces](https://codespaces.new/Blockdaemon/demo-buildervault-stakingAPI?quickstart=1)
  - Create Fireblocks [API and Secret key](https://developers.fireblocks.com/docs/manage-api-keys) for use with the [Fireblocks Web3 provider](https://github.com/fireblocks/fireblocks-web3-provider)
  - Ensure you have a Fireblocks Transaction Policy that permits Contract Calls for your Ethereum vault [Fireblocks TAP](https://developers.fireblocks.com/reference/configure-transaction-authorization-policy#tap-examples)
  - Should you wish to allow-list the contracts, the Blockdaemon Ethereum Batch Deposit addresses are:
     - Mainnet validator type 0x01:`0x3F124C700fb5E741F128e28985267D44f56B242F`
     - Mainnet validator type 0x02: `0xDc8D2A1d8cd79e1542441743e448129a00A59aE0`
     - Hoodi types 0x01 and 0x02: `0x106903a059E9DE6636b17b2E7913a7c1d85C799a`
  - Register a free Blockdaemon [Staking API key](https://docs.blockdaemon.com/reference/get-started-staking-api#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_STAKE_API_KEY

### Step 1. Set environment variables in .env
```shell
cd ethereum-staking/fireblocks/nodejs/
cp .env.example .env
```
- update .env with API keys and Fireblocks Vault details

### Step 2. Install package dependancies
```shell
npm install
```

### Step 3. Launch ethereum-stake-fb.ts to determine the Fireblocks wallet address
```shell
npm run start ethereum-stake-fb.ts
```
- if needed, copy the new Ethereum wallet address and fund the account with https://holesky-faucet.pk910.de/#/

### Step 4. Re-launch ethereum-stake-fb.ts to generate the Stake Intent request, execute the contract with Fireblocks, and broadcast the transaction
```shell
npm run start ethereum-stake-fb.ts
```
- observe the confirmed transaction through the generated blockexplorer link
