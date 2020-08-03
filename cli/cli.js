#!/usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const BN = require("bn.js");
const URI = require("urijs");
const commander = require("commander");
const AvaJS = require("avalanche");
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const Ledger = require("@ledgerhq/hw-app-avalanche").default;

const AVAX_ASSET_ID = "AVA"; // TODO changes to AVAX in next release

// TODO replace this with something better
function log_error_and_exit(err) {
  console.error(err.message);
  process.exit(1);
}

// Convenience function to add the --device option
commander.Command.prototype.add_device_option = function() {
  return this.option("-d, --device <device>", "device to use");
}

// Convenience function to add the --node option
commander.Command.prototype.add_node_option = function() {
  return this.option("-n, --node <uri>", "node to use", "http://localhost:9650");
}

function ava_js_with_node(uri_string) {
  const uri = URI(uri_string);
  return new AvaJS.Avalanche(uri.hostname(), uri.port(), uri.protocol(), 3);
}

const program = new commander.Command();

program.version("0.0.1");

program
  .command("list-devices")
  .action(async () => {
  console.log(await TransportNodeHid.list());
});

program
  .command("get-device-model")
  .add_device_option()
  .action(async (options) => {
    const transport = await TransportNodeHid.open(options.device).catch(log_error_and_exit);
    console.log(transport.deviceModel);
});

// TODO does not work on Ava ledger app
program
  .command("get-wallet-id")
  .add_device_option()
  .action(async (options) => {
    const transport = await TransportNodeHid.open(options.device).catch(log_error_and_exit);
    const ledger = new Ledger(transport);
    const result = await ledger.getWalletId().catch(log_error_and_exit);
    console.log(result);
});

program
  .command("get-wallet-pubkey <path>")
  .description("get the public key of a derivation path. <path> should be 'account/change/address_index'")
  .add_device_option()
  .action(async (path, options) => {
    const transport = await TransportNodeHid.open(options.device).catch(log_error_and_exit);
    const ledger = new Ledger(transport);
    // BIP32: m / purpose' / coin_type' / account' / change / address_index
    path = "m/44'/9000'/" + path
    console.log("Getting public key for path ", path);
    const result = await ledger.getWalletPublicKey(path).catch(log_error_and_exit);
    console.log(result);
});

program
  .command("get-balance <address>")
  .add_node_option()
  .action(async (address, options) => {
    const ava = ava_js_with_node(options.node);
    const avm = ava.AVM();
    let result = await avm.getBalance(address, AVAX_ASSET_ID).catch(log_error_and_exit);
    console.log(result.toString(10, 0));
});

program
  .command("get-utxos <address>")
  .add_node_option()
  .action(async (address, options) => {
    const ava = ava_js_with_node(options.node);
    const avm = ava.AVM();
    let result = await avm.getUTXOs([address]).catch(log_error_and_exit);
    console.log(result);
});

async function main() {
  await program.parseAsync(process.argv);
}

main();
