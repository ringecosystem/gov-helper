import axios from 'axios';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';

async function main(): Promise<void> {
  if (process.argv.length < 4) {
    throw new Error('missing arguments: <wssUri> <codeUri>');
  }

  const privateKey = process.env.GOV_PROXY_KEY;

  if (!privateKey) {
    throw new Error('missing GOV_PROXY_KEY environment variable');
  }

  const pair = await EvmKeyringPair(privateKey);
  const wssUri = process.argv[2];
  const codeUri = process.argv[3];
  const provider = new WsProvider(wssUri);

  console.log(`connecting to ${wssUri}`);

  const connectionPromise = ApiPromise.create({ provider });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('connection timeout after 5 secs')), 5_000);
  });
  const api = await Promise.race([connectionPromise, timeoutPromise]) as ApiPromise;
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ]);

  console.log(`connected to ${chain} using ${nodeName} v${nodeVersion}`);

  const header = await api.rpc.chain.getHeader();

  console.log(`latest block: #${header.number} ${header.hash}`);

  const code = await download(codeUri);
  const codeSizeKb = Math.round(code.length / 1024);

  console.log(`downloaded code(${codeSizeKb} KB)`);

  const codeHash = blake2b256(code);

  console.log(`code hash: ${codeHash}`);

  const authorizeUpgrade = api.tx.system.authorizeUpgrade(codeHash);
  const authorizeUpgradeCallData = authorizeUpgrade.method.toHex();
  const authorizeUpgradeHash = authorizeUpgrade.method.hash.toHex();

  console.log(`authorizeUpgrade call data: ${authorizeUpgradeCallData}`);
  console.log(`authorizeUpgrade hash: ${authorizeUpgradeHash}`);

  const whitelist = api.tx.whitelist.whitelistCall(authorizeUpgradeHash);

  console.log(`whitelist call data: ${whitelist.method.toHex()}`);
  console.log(`whitelist call hash: ${whitelist.method.hash.toHex()}`);

  const techCommProposal = api.tx.technicalCommittee.propose(
    4,
    whitelist,
    whitelist.length
  );

  console.log(`techCommProposal call data: ${techCommProposal.method.toHex()}`);
  console.log(`techCommProposal hash: ${techCommProposal.method.hash.toHex()}`);

  const whitelistDispatch = api.tx.whitelist.dispatchWhitelistedCallWithPreimage(authorizeUpgradeCallData);
  const whitelistDispatchCallData = whitelistDispatch.method.toHex();

  console.log(`whitelistDispatch call data: ${whitelistDispatchCallData}`);
  console.log(`whitelistDispatch hash: ${whitelistDispatch.method.hash.toHex()}`);

  const referendaProposal = api.tx.referenda.submit(
    { Origins: 'WhitelistedCaller' },
    { Inline: whitelistDispatchCallData },
    { After: 100 }
  );

  console.log(`referendaProposal call data: ${referendaProposal.method.toHex()}`);
  console.log(`referendaProposal hash: ${referendaProposal.method.hash.toHex()}`);

  await signAndSendTx(pair, techCommProposal);
  await signAndSendTx(pair, referendaProposal);
  await api.disconnect();

  console.log('disconnected from node');
  console.log('process completed successfully');
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(-1);
});

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

async function signAndSendTx(pair: KeyringPair, tx: any): Promise<void> {
  console.log(`signing and sending tx: ${tx.method.section}.${tx.method.method}`);

  return new Promise((resolve, reject) => {
    tx.signAndSend(pair, { nonce: -1 }, (result: any) => {
      const { status } = result;

      console.log(`tx status: ${status.type}`);

      if (status.isInBlock || status.isFinalized) {
        console.log(`tx included in block: ${status.asInBlock.toHex()}`);

        resolve();
      } else if (status.isError) {
        reject(new Error('tx failed'));
      }
    }).catch(reject);
  });
}