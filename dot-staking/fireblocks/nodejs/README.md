# TypeScript Polkadot Staking with Fireblocks Wallet

This project allows users to stake Polkadot tokens (DOT) or Westend tokens (WND) using the Fireblocks wallet to sign transactions and Blockdaemon Staking API to perform the staking. By integrating Fireblocks for secure signing and Blockdaemon for staking, this process is automated and seamless.

---

### Prerequisites

Before starting, ensure you have the following:

- **Node.js**: Ensure that [Node.js](https://nodejs.org/en/download/package-manager) is installed on your machine.
- **Fireblocks Account**:
    - [Create Fireblocks API and Secret key](https://developers.fireblocks.com/docs/manage-api-keys) to interact with the Fireblocks API.
    - [Fireblocks TypeScript SDK](https://github.com/fireblocks/ts-sdk) for interacting with Fireblocks.
- **Blockdaemon Staking API**:
    - [Register for Blockdaemon's Staking API key](https://docs.blockdaemon.com/reference/get-started-staking-api#step-1-sign-up-for-an-api-key) to interact with their Staking API. Make sure to save this API key as `BLOCKDAEMON_STAKE_API_KEY` in your `.env` file.
- **Polkadot Network Configuration**:
    - Set the `POLKADOT_NETWORK` in `.env` to `mainnet` or `westend` depending on the network you're using.

---

### Step 1. Set environment variables in `.env`

```shell
cd dot-staking/fireblocks/nodejs/
cp .env.example .env
```

Open .env and update the following environment variables:
```shell
BLOCKDAEMON_STAKE_API_KEY: Your Blockdaemon Staking API key.
POLKADOT_NETWORK: Set to either mainnet or westend depending on the network you are using.
FIREBLOCKS_API_KEY: Your Fireblocks API key.
FIREBLOCKS_SECRET_KEY: Path to your Fireblocks secret key file.
FIREBLOCKS_VAULT_ACCOUNT_ID: The vault account ID in Fireblocks for the asset you want to use (e.g., WND or DOT).
BLOCKDAEMON_API_KEY: Your Blockdaemon API key.
```

### Step 2. Install dependencies

```shell
npm install
```
This will install all required packages, including the Fireblocks SDK and Blockdaemon's API interaction tools.

### Step 3. To perform a polkadot stake intent then run.
```shell
npm run stake
```
This will create the transaction to create a proxy on your account to Blockdaemons where we nominate on your behalf.

### Step 4. To perform a bond extra 
```shell
npm run bond
```
This will then bond extra funds to your already nominated pool.

Generate a Stake Intent request to initiate staking.
Use Fireblocks to sign the transaction.
Broadcast the transaction to the Polkadot network using Blockdaemon's Staking API.
You can optionally view the signed transaction contents in a block explorer, such as [Westend Subscan](https://westend.subscan.io/), and track the confirmed transaction through the generated block explorer link.