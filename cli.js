#! /usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const { default: TransportNodeHid } = require("@ledgerhq/hw-transport-node-hid");

function help() {
  console.log('Avalanche Wallet CLI');
  console.log('Commands:');
  console.log('  list-connected-ledgers List connected ledger devices');
  console.log('  ledger-model           Display the model info of the first ledger');
  console.log('  help                   Display this help text');
  process.exit();
}

async function list_devices() {
  console.log('List devices');
  console.log(await TransportNodeHid.list());
  process.exit();
}

async function ledger_model() {
  await TransportNodeHid.create().then(transport => {
    console.log(transport.deviceModel);
    process.exit();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

async function main() {
  const args = process.argv.slice(2);

  const arg_help = args.indexOf('help') >= 0;
  const arg_list_devices = args.indexOf('list-connected-ledgers') >= 0;
  const arg_ledger_model = args.indexOf('ledger-model') >= 0;

  if (arg_help) help();
  if (arg_list_devices) await list_devices();
  if (arg_ledger_model) await ledger_model();

  console.log('Avalanche Wallet CLI: Missing command. Try "help".');
}

main();
