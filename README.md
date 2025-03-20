# Darwinia Polkadot-SDK Governance Helper

A utility project to interact with Polkadot-SDK governance features on Darwinia/Crab networks.

## Usage

1. Set the qualified members in the `AUTHORIZED_AUTHORS=` section of the workflow file. This will prevent other users' issues from being processed.
2. Set `GOV_PROXY_KEY` in this repository's secrets. This key is used to sign the transaction on behalf of the governance proxy account.
3. Creating a new issue on this repository, prefix the title with `[GOV]`, and ensure that the first two lines of the body are as follows:

    ```plain
    <WSS-URI>  # wss://rpc.darwinia.network
    <CODE-URI> # https://github.com/darwinia-network/darwinia/releases/download/v7.0.0/darwinia_runtime.compact.compressed.wasm
    ```

## Local Development

### Setup

1. Install dependencies:

    ```sh
    chmod +x install.sh && ./install.sh
    ```

2. Run:

    ```sh
    yarn build && yarn start
    ```

### Updating Dependencies

To update to the latest version of all packages:

```sh
yarn upgrade --latest
```
