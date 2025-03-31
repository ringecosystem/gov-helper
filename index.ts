import axios from 'axios';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';

// Constants.
const CONF = {
  GOV_PROXY_ADDR: '0x3e25247CfF03F99a7D83b28F207112234feE73a6',
  TECH_COMM_THRESHOLD: 4,
  REFERENDUM_AFTER_BLOCKS: 100,
};

// Types and Interfaces.
interface GovProposalOptions {
  techCommThreshold?: number;
  referendumDelay?: number;
  proxyAddress?: string;
}

interface CallGenerator {
  generate(api: ApiPromise): Promise<any>;
}

// Call Generators.
class RuntimeUpgradeCallGenerator implements CallGenerator {
  private codeUri: string;

  constructor(codeUri: string) {
    this.codeUri = codeUri;
  }

  async generate(api: ApiPromise): Promise<any> {
    const code = await download(this.codeUri);
    const codeSizeKb = Math.round(code.length / 1024);

    console.log(`downloaded code(${codeSizeKb} KB)`);

    const codeHash = blake2b256(code);

    console.log(`code hash: ${codeHash}`);

    return api.tx.system.authorizeUpgrade(codeHash);
  }
}

class RawCallGenerator implements CallGenerator {
  private callData: string;

  constructor(callData: string) {
    this.callData = callData.startsWith('0x') ? callData : `0x${callData}`;
  }

  async generate(api: ApiPromise): Promise<any> {
    console.log(`Using raw call data: ${this.callData}`);

    // Create the call from the hex data.
    return api.tx(this.callData);
  }
}

// Main function
async function main(): Promise<void> {
  if (process.argv.length < 3) {
    throw new Error('missing arguments: <wssUri> <proposal-type> [proposal-args...]');
  }

  const privateKey = process.env.GOV_PROXY_KEY;

  if (!privateKey) {
    throw new Error('missing GOV_PROXY_KEY environment variable');
  }

  const pair = await EvmKeyringPair(privateKey);
  const wssUri = process.argv[2];
  const proposalType = process.argv[3];
  const api = await connectToNode(wssUri);

  try {
    let callGenerator: CallGenerator;

    switch (proposalType) {
      case 'runtime-upgrade':
        const codeUri = process.argv[4];

        if (!codeUri) {
          throw new Error('runtime-upgrade requires a codeUri argument');
        }

        callGenerator = new RuntimeUpgradeCallGenerator(codeUri);

        break;

      case 'any':
        const callData = process.argv[4];

        if (!callData) {
          throw new Error('any proposal type requires call data as an argument');
        }

        callGenerator = new RawCallGenerator(callData);

        break;

      // Add more proposal types as needed

      default:
        console.log('unknown proposal type. Available proposal types:');
        console.log('  runtime-upgrade <code-uri>   - submit runtime upgrade proposal using code from URL');
        console.log('                                 example: runtime-upgrade https://example.com/runtime.wasm');
        console.log('  any <call-data>              - submit proposal with raw call data (hex-encoded)');
        console.log('                                 example: any 0x...');
        console.log('');
        console.log('usage: yarn start <wss-uri> <proposal-type> <proposal-arg>');

        process.exit(1);
    }

    console.log(`Processing governance proposal for: ${proposalType}`);

    await executeGovernanceWorkflow(api, pair, callGenerator, wssUri);
  } finally {
    await api.disconnect();

    console.log('disconnected from node');
    console.log('process completed successfully');
  }
}

async function executeGovernanceWorkflow(
  api: ApiPromise,
  pair: KeyringPair,
  callGenerator: CallGenerator,
  wssUri: string,
  options: GovProposalOptions = {}
): Promise<void> {
  // Generate the initial call.
  const initialCall = await callGenerator.generate(api);

  // Process the governance proposal with the generated call.
  await processGovernanceProposal(api, pair, initialCall, wssUri, options);
}

async function connectToNode(wssUri: string): Promise<ApiPromise> {
  console.log(`connecting to ${wssUri}`);

  const provider = new WsProvider(wssUri);
  const connectionPromise = ApiPromise.create({ provider, noInitWarn: true });
  const timeoutPromise = new Promise<ApiPromise>((_, reject) => {
    setTimeout(() => reject(new Error(`connection timeout after 5 secs - could not connect to ${wssUri}`)), 5_000);
  });

  try {
    const api = await Promise.race([connectionPromise, timeoutPromise]) as ApiPromise;
    const [chain, nodeName, nodeVersion] = await Promise.all([
      api.rpc.system.chain(),
      api.rpc.system.name(),
      api.rpc.system.version()
    ]);

    console.log(`connected to ${chain} at ${nodeName}-v${nodeVersion}`);

    const header = await api.rpc.chain.getHeader();

    console.log(`latest block: #${header.number} ${header.hash}`);

    return api;
  } catch (e: any) {
    console.error(`failed to connect to node: ${e.message}`);

    throw new Error(`connection failed: ${e.message}`);
  }
}

async function processGovernanceProposal(
  api: ApiPromise,
  pair: KeyringPair,
  initialCall: any,
  wssUri: string,
  options: GovProposalOptions = {}
): Promise<void> {
  const {
    techCommThreshold = CONF.TECH_COMM_THRESHOLD,
    referendumDelay = CONF.REFERENDUM_AFTER_BLOCKS,
    proxyAddress = CONF.GOV_PROXY_ADDR
  } = options;
  const initialCallData = initialCall.method.toHex();
  const initialCallHash = initialCall.method.hash.toHex();

  console.log(`initial call data: ${initialCallData}`);
  console.log(`initial call hash: ${initialCallHash}`);

  // Create whitelist proposal.
  const whitelist = api.tx.whitelist.whitelistCall(initialCallHash);

  console.log(`whitelist call data: ${whitelist.method.toHex()}`);
  console.log(`whitelist call hash: ${whitelist.method.hash.toHex()}`);

  // Create technical committee proposal.
  const techCommProposal = api.tx.technicalCommittee.propose(
    techCommThreshold,
    whitelist,
    whitelist.length
  );

  console.log(`techCommProposal call data: ${techCommProposal.method.toHex()}`);
  console.log(`techCommProposal hash: ${techCommProposal.method.hash.toHex()}`);

  // Create whitelist dispatch.
  const whitelistDispatch = api.tx.whitelist.dispatchWhitelistedCallWithPreimage(initialCallData);
  const whitelistDispatchCallData = whitelistDispatch.method.toHex();

  console.log(`whitelistDispatch call data: ${whitelistDispatchCallData}`);
  console.log(`whitelistDispatch hash: ${whitelistDispatch.method.hash.toHex()}`);

  // Create referendum proposal.
  const referendaProposal = api.tx.referenda.submit(
    { Origins: 'WhitelistedCaller' },
    { Inline: whitelistDispatchCallData },
    { After: referendumDelay }
  );

  console.log(`referendaProposal call data: ${referendaProposal.method.toHex()}`);
  console.log(`referendaProposal hash: ${referendaProposal.method.hash.toHex()}`);

  // Create proxy calls.
  const proxyTechCommProposal = api.tx.proxy.proxy(
    proxyAddress,
    { Governance: null },
    techCommProposal
  );

  console.log(`proxyTechCommProposal call data: ${proxyTechCommProposal.method.toHex()}`);
  console.log(`proxyTechCommProposal hash: ${proxyTechCommProposal.method.hash.toHex()}`);

  const proxyReferendaProposal = api.tx.proxy.proxy(
    proxyAddress,
    { Governance: null },
    referendaProposal
  );

  console.log(`proxyReferendaProposal call data: ${proxyReferendaProposal.method.toHex()}`);
  console.log(`proxyReferendaProposal hash: ${proxyReferendaProposal.method.hash.toHex()}`);

  // Sign and send transactions.
  await signAndSendTx(pair, proxyTechCommProposal, wssUri);
  await signAndSendTx(pair, proxyReferendaProposal, wssUri);
}

// Utility functions.
async function EvmKeyringPair(privateKey: string): Promise<KeyringPair> {
  await cryptoWaitReady();

  const keyring = new Keyring({ type: 'ethereum' });
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const pair = keyring.addFromSeed(hexToU8a(formattedPrivateKey));

  console.log(`loaded EVM keyring for address: ${pair.address}`);

  return pair;
}

async function download(uri: string): Promise<Buffer> {
  console.log(`downloading ${uri}`);

  const response = await axios.get(uri, { responseType: 'arraybuffer' });

  return Buffer.from(response.data);
}

function blake2b256(buffer: Buffer): string {
  return blake2AsHex(buffer, 256);
}

async function signAndSendTx(pair: KeyringPair, tx: any, wssUri?: string): Promise<void> {
  console.log(`signing and sending tx: ${tx.method.section}.${tx.method.method}`);

  return new Promise((resolve, reject) => {
    tx.signAndSend(pair, { nonce: -1 }, (result: any) => {
      const { status } = result;

      console.log(`tx status: ${status.type}`);

      if (status.isInBlock || status.isFinalized) {
        const blockHash = status.isInBlock ? status.asInBlock : status.asFinalized;
        const blockHashHex = blockHash.toHex();

        console.log(`tx included in block: ${blockHashHex}`);

        if (wssUri) {
          const explorerUri = `https://polkadot.js.org/apps/?rpc=${wssUri}#/explorer/query/${blockHashHex}`;

          console.log(`block explorer URL: ${explorerUri}`);
        }

        resolve();
      } else if (status.isError) {
        reject(new Error('tx failed'));
      }
    }).catch(reject);
  });
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(-1);
});