# Darwinia Polkadot-SDK Governance Helper

A utility project to interact with Polkadot-SDK governance features on Darwinia/Crab networks. This tool supports different types of governance proposals including runtime upgrades and custom calls.

## Usage

### Repository Workflow

1. Set the qualified members in the `AUTHORIZED_AUTHORS=` section of the workflow file. This will prevent other users' issues from being processed.
2. Set `GOV_PROXY_KEY` in this repository's secrets. This key is used to sign the transaction on behalf of the governance proxy account.
3. Creating a new issue on this repository, prefix the title with `[GOV]`, and ensure that the body contains the required parameters:

    ```plain
    <WSS-URI>        # e.g., wss://rpc.darwinia.network
    <PROPOSAL-TYPE>  # Either 'runtime-upgrade' or 'any'
    <PROPOSAL-ARG>   # For runtime-upgrade: code URI, for any: raw call data
    ```

### Direct Command Line Usage

You can also run the tool directly from the command line:

```sh
# For runtime upgrades
yarn start <wssUri> runtime-upgrade <codeUri>

# Example:
yarn start wss://rpc.darwinia.network runtime-upgrade https://github.com/darwinia-network/darwinia/releases/download/v7.0.0/darwinia_runtime.compact.compressed.wasm
```

```sh
# For any arbitrary call
yarn start <wssUri> any <callData>

# Example:
yarn start wss://rpc.darwinia.network any 0x1a0212000100060000c80000000000000000
```

### Environment Variables

- `GOV_PROXY_KEY`: The private key of the account that will sign the transactions.

## Governance Flow

This helper automates the following governance flow:

1. For runtime upgrades: Downloads the runtime code and creates an `authorizeUpgrade` call
2. For custom calls: Uses the provided call data directly
3. Creates a technical committee proposal to whitelist the call
4. Creates a referendum proposal to dispatch the whitelisted call
5. Signs and submits both proposals using the governance proxy account

## Local Development

### Setup

1. Install dependencies:

    ```sh
    yarn install
    ```

2. Run:

    ```sh
    yarn build && yarn start wss://rpc.darwinia.network runtime-upgrade https://path/to/runtime.wasm
    # OR
    yarn build && yarn start wss://rpc.darwinia.network any 0xYOUR_CALL_DATA_HERE
    ```

### Updating Dependencies

To update to the latest version of all packages:

```sh
yarn upgrade --latest
```
