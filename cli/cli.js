#!/usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const createHash = require('create-hash');
const EC = require("elliptic").ec; // TODO remove
const BN = require("bn.js");
const URI = require("urijs");
const commander = require("commander");
const AvaJS = require("avalanche");
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const Ledger = require("@ledgerhq/hw-app-avalanche").default;

const BinTools = AvaJS.BinTools.getInstance();

const AVAX_ASSET_ID = "AVA"; // TODO changes to AVAX in next release
const AVAX_ASSET_ID_SERIALIZED = BinTools.b58ToBuffer("9xc4gcJYYg1zfLeeEFQDLx4HnCk81yUmV1DAUc6VfJFj"); // TODO is this correct? I got this from my account's UTXOSet. I have no idea how it is created.

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
  return this.option("-n, --node <uri>", "node to use", "https://testapi.avax.network");
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
    pubk = Buffer.from(result,'hex');
    KC = new AvaJS.AVMKeyPair();
    pubk_hash = KC.addressFromPublicKey(pubk);
    address = BinTools.avaSerialize(pubk_hash);
    console.log(address);
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
    console.log(result.getAllUTXOs());
});

/* Adapted from avm/tx.ts for class UnsignedTx */
async function sign_UnsignedTx(unsignedTx) {
  const txbuff = unsignedTx.toBuffer();
  const msg = Buffer.from(createHash('sha256').update(txbuff).digest());
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(baseTx, msg);
  return new AvaJS.Tx(unsignedTx, sigs);
}

/* Adapted from avm/tx.ts for class BaseTx */
async function sign_BaseTx(baseTx, msg) {
  const sigs = [];
  for (let i = 0; i < baseTx.ins.length; i++) {
    const cred = AvaJS.SelectCredentialClass(baseTx.ins[i].getInput().getCredentialID());
    const sigidxs = baseTx.ins[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      const signval = await sign_AVMKeyPair(msg);
      const sig = new AvaJS.Signature();
      sig.fromBuffer(Buffer.from(signval, "hex"));
      cred.addSignature(sig);
    }
    sigs.push(cred);
  }
  return sigs;
}

/* Adapted from avm/keychain.ts for class AVMKeyPair */
async function sign_AVMKeyPair(msg) {
  const sigObj = await sign_bytes(msg);
  //const recovery = Buffer.alloc(1);
  //recovery.writeUInt8(sigObj.recoveryParam, 0);
  //const r = Buffer.from(sigObj.r.toArray('be', 32)); // we have to skip native Buffer class, so this is the way
  //const s = Buffer.from(sigObj.s.toArray('be', 32)); // we have to skip native Buffer class, so this is the way
  //const result = Buffer.concat([r, s, recovery], 65);
  //return result;
  return sigObj;
}

// TODO Use the ledger signing function
// TODO Remove the elliptic dependency
async function sign_bytes(msg) {
  const transport = await TransportNodeHid.open().catch(log_error_and_exit);
  const ledger = new Ledger(transport);
  // BIP44: m / purpose' / coin_type' / account' / change / address_index
  path = "m/44'/9000'/0'/0'";
  hash = msg;
  console.log("Signing hash ", hash, " with path ", path);
  const result = await ledger.signHash(path, msg).catch(log_error_and_exit);
  console.log(result);
  result2 = result.slice(64, -4);
  console.log(result2);
  return result2;
}

function parse_amount(str) {
  try {
    return new BN(str);
  } catch (e) {
    console.error("Couldn't parse amount: ", e.message);
    console.error("Hint: Amount should be an integer, specified in nanoAVAX.");
    process.exit(1);
  }
}

program
  .command("transfer")
  .description("Transfer AVAX between accounts")
  .requiredOption("--amount <amount>", "Amount to transfer, specified in nanoAVAX")
  .requiredOption("--from <account>", "Account the funds will be taken from")
  .requiredOption("--to <account>", "Recipient account")
  // TODO this option makes it very easy for someone to send a load of AVAX somewhere without realising.
  // e.g. transfer --amount 10 --from my-account --to friend --change my-other-account-with-typo
  // and if you have 10010 coins originally, you just sent 10000 coins to the wrong address
  .option("--change <account>", "Account leftover funds will be sent to. Defaults to the 'from' address.")
  .add_node_option()
  .action(async options => {
    const toAddress = options.to;
    const fromAddress = options.from;
    const changeAddress = options.change === undefined ? options.from : options.change;
    const amount = parse_amount(options.amount);

    const avm = ava_js_with_node(options.node).AVM();
    const utxos = await avm.getUTXOs([fromAddress]).catch(log_error_and_exit);
    const unsignedTx = await
      avm.buildBaseTx(utxos, amount, [toAddress], [fromAddress], [changeAddress], AVAX_ASSET_ID_SERIALIZED)
      .catch(log_error_and_exit);
    const signed = await sign_UnsignedTx(unsignedTx);
    const txid = await avm.issueTx(signed);
    console.log(txid);
});

async function main() {
  await program.parseAsync(process.argv);
}

main();
