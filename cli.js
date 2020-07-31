#!/usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const commander = require("commander");
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const Avalanche = require("@ledgerhq/hw-app-avalanche").default;

// TODO replace this with something better
function log_error_and_exit(err) {
  console.error(err.message);
  process.exit(1);
}

// Convenience function to add the --device option
commander.Command.prototype.add_device_option = function() {
  return this.option("-d, --device <device>", "device to use");
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
    const ava = new Avalanche(transport);
    const result = await ava.getWalletId().catch(log_error_and_exit);
    console.log(result);
});

program
  .command("get-wallet-pubkey <path>")
  .description("get the public key of a derivation path. <path> should be 'account/change/address_index'")
  .add_device_option()
  .action(async (path, options) => {
    const transport = await TransportNodeHid.open(options.device).catch(log_error_and_exit);
    const ava = new Avalanche(transport);
    // BIP32: m / purpose' / coin_type' / account' / change / address_index
    path = "m/44'/9000'/" + path
    console.log("Getting public key for path ", path);
    const result = await ava.getWalletPublicKey(path).catch(log_error_and_exit);
    console.log(result);
});

async function main() {
  await program.parseAsync(process.argv);
}

main();

