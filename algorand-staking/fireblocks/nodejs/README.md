
# TypeScript Algorand staking with Fireblocks wallet


### Prerequisites
  - [Node.js](https://nodejs.org/en/download/package-manager) or launch in [code-spaces](https://codespaces.new/Blockdaemon/demo-buildervault-stakingAPI?quickstart=1)
  - Create Fireblocks [API and Secret key](https://developers.fireblocks.com/docs/manage-api-keys) for use with the [Fireblocks TypeScript SDK](https://github.com/fireblocks/ts-sdk)
  - Requires Algorand Partipant Node and Registration Key


### Step 1. Set environment variables in .env
```shell
cd algorand-staking/fireblocks/nodejs/
cp .env.example .env
```
- update .env Fireblocks Vault Account ID and credentials

### Step 2. Install package dependancies
```shell
npm install
```

### Step 3. Launch algorand-stake-fb.ts to generate registration key txn, sign the request with Fireblocks and broadcast the transaction
```shell
ALGORAND_VOTE_KEY="fUJ9mLtU6hBsOzl/Wed9BmYukYKFXq2SptIdADMtEwY=" \
ALGORAND_SELECTION_KEY="pjyIMD0fLyDEl67xLnmO9qtMawbvmxnCgULgk+GskDA=" \
ALGORAND_STATE_PROOF_KEY="x8leliS8SPaH12HPfrme4LDxcqdX5VZ6Os6y1E9vHnZSlhEpH22ZogWtW4R7qz0X5vEEY+C22i3EZ80r4CvdYw==" \
ALGORAND_VOTE_FIRST=51000000 \
ALGORAND_VOTE_LAST=60000000 \
ALGORAND_VOTE_KEY_DILUTION=3001 \
npm run start algorand-stake-fb.ts
```

- Fund with testnet faucet: https://bank.testnet.algorand.network
- [optional] view the signed transaction contents with inspector: https://testnet.explorer.perawallet.app
