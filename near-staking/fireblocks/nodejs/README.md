
# TypeScript Near staking with Fireblocks wallet


### Prerequisites
  - [Node.js](https://nodejs.org/en/download/package-manager) or launch in [code-spaces](https://codespaces.new/Blockdaemon/demo-buildervault-stakingAPI?quickstart=1)
  - Create Fireblocks [API and Secret key](https://developers.fireblocks.com/docs/manage-api-keys) for use with the [Fireblocks TypeScript SDK](https://github.com/fireblocks/ts-sdk)
  - Register free Blockdaemon [Staking API key](https://docs.blockdaemon.com/reference/get-started-staking-api#step-1-sign-up-for-an-api-key) and set in .env as BLOCKDAEMON_STAKE_API_KEY


### Step 1. Set environment variables in .env
```shell
cd near-staking/fireblocks/nodejs/
cp .env.example .env
```
- update .env with API keys, Fireblocks Vault ID

### Step 2. Install package dependancies
```shell
npm install
```

### Step 3. Launch example.ts to generate the Stake Intent request, sign the request with Fireblocks and broadcast the transaction
```shell
npm run start example.ts
```
- [optional] view the signed transaction contents with inspector: https://nearblocks.io/
- observe the confirmed transaction through the generated blockexplorer link


This leverages the following operation here at Blockdaemon. You will need a key for our staking API as well as one for the [Blockdaemon API suite](https://docs.blockdaemon.com/docs/quick-start-blockdaemon-api-suite)
- https://docs.blockdaemon.com/reference/near-api-overview
- https://docs.blockdaemon.com/reference/txcompileandsend-txapi
