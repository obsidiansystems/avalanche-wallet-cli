#!/usr/bin/env node

const AvaJS = require("avalanche");
const bech32 = require('bech32');
const BinTools = AvaJS.BinTools.getInstance();
const BN = require("bn.js");
const commander = require("commander");
const HDKey = require('hdkey');
const Ledger = require("@ledgerhq/hw-app-avalanche").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const URI = require("urijs");

const FAUCET_USERNAME = "faucet";
const FAUCET_PASSWORD = "good-cub-book";
const FAUCET_ADDRESS = "X-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u";
const AVAX_ASSET_ID = "AVAX";
const AVA_BIP32_PREFIX = "m/44'/9000'/0'" // Restricted to 0' for now

function logErrorAndExit(err) {
  if (err.message === undefined) {
    console.error(err);
  } else {
    console.error(err.message);
  }
  process.exit(1);
}

const program = new commander.Command();

program.version("0.0.1");

// Convenience function to add the --node option
commander.Command.prototype.addNodeOption = function() {
  return this.option("-n, --node <uri>", "node to use", "http://localhost:9652"); // This is the default for the testnet scripts
}

function avaJsWithNode(uri_string) {
  const uri = URI(uri_string);
  return new AvaJS.Avalanche(uri.hostname(), uri.port(), uri.protocol(), 12345);
}

async function getExtendedPublicKey(ledger, deriv_path) {
  console.error("Please accept on your ledger device");
  extended_public_key = await ledger.getWalletExtendedPublicKey(deriv_path).catch(logErrorAndExit);
  hdw = new HDKey();
  hdw.publicKey = extended_public_key.public_key;
  hdw.chainCode = extended_public_key.chain_code;
  return hdw
}

function hdkey_to_pkh(hdkey) {
  return (new AvaJS.common.SECP256k1KeyPair()).addressFromPublicKey(hdkey.publicKey);
}

function pkh_to_avax_address(pkh) {
  return "X-" + bech32.encode("local", bech32.toWords(pkh));
}

// Convert a 'hdkey' (from the library of the same name) to an AVAX address.
function hdkey_to_avax_address(hdkey) {
  return pkh_to_avax_address(hdkey_to_pkh(hdkey));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

program
  .command("fund-address <address> <amount>")
  .description("Fund an address with <amount>")
  .addNodeOption()
  .action(async (address, amount, options) => {
  const ava = avaJsWithNode(options.node);
  const avm = ava.XChain();

  const amountBN = new BN(amount);
  let txHash = await avm.send(FAUCET_USERNAME, FAUCET_PASSWORD, AVAX_ASSET_ID, amountBN, address, [FAUCET_ADDRESS]).catch(logErrorAndExit);
  console.log(txHash.toString());
});

program
  .command("fund-ledger <amount>")
  .description("Fund the first 5 non-change addresses of a ledger device with <amount>")
  .addNodeOption()
  .action(async (amount, options) => {
  const transport = await TransportNodeHid.open().catch(logErrorAndExit);
  const ledger = new Ledger(transport);
  const ava = avaJsWithNode(options.node);
  const avm = ava.XChain();

  const amountBN = new BN(amount);
  const non_change_key = await getExtendedPublicKey(ledger, AVA_BIP32_PREFIX + "/0");
  for (let i = 0; i < 5; i++) {
    const key = non_change_key.deriveChild(i);
    const to = hdkey_to_avax_address(key);
    const txHash = await avm.send(FAUCET_USERNAME, FAUCET_PASSWORD, AVAX_ASSET_ID, amountBN, to, [FAUCET_ADDRESS]).catch(logErrorAndExit);
    console.error("Funding", i, to, "TX", txHash.toString());
    await sleep(2000);
  }
});

async function main() {
  await program.parseAsync(process.argv);
}

main();
