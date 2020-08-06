#!/usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const HDKey = require('hdkey');
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
const AVA_BIP32_PREFIX = "m/44'/9000'/"
const INDEX_RANGE = 20; // a gap of at least 20 indexes is needed to claim an index unused

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
    path = AVA_BIP32_PREFIX + path
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
  .description("Get the AVAX balance of a particular address")
  .add_node_option()
  .action(async (address, options) => {
    const ava = ava_js_with_node(options.node);
    const avm = ava.AVM();
    let result = await avm.getBalance(address, AVAX_ASSET_ID).catch(log_error_and_exit);
    console.log(result.toString(10, 0));
});

// TODO get this from the ledger using the given account
function get_extended_public_key() {
  return "xpub6C6ML72NdxwLnu2hW85mGhX3oTsfFW12KAHP2Q3aK13tYY7c4TN272qnYQKmju17AwSqr982Su2pVLmRrkRnGP3C5BDbZrVje8Eq7SxzkfP";
}

// Scan change addresses and find the first unused address (i.e. the first with no UTXOs)
// Adapted from wallet code. TODO this doesn't use the INDEX_RANGE thing, should it?
async function get_change_address(avm, log = false) {
  const extended_public_key = get_extended_public_key();
  const root_key = HDKey.fromExtendedKey(extended_public_key);
        change_key = root_key.deriveChild(1); // 1 = change

  var index = 0;
  var foundAddress = null;
  while (foundAddress === null) {
    const key = change_key.deriveChild(index);
    const address = hdkey_to_avax_address(key);
    const utxos = await avm.getUTXOs([address]).catch(log_error_and_exit);
    const is_unused = utxos.getAllUTXOs().length === 0;
    if (log) console.error("Index", index, address, is_unused ? "Unused" : "Used");
    if (is_unused) foundAddress = address;
    index++;
  }

  return foundAddress;
}

function hdkey_to_pkh(hdkey) {
  const KC = new AvaJS.AVMKeyPair();
  return KC.addressFromPublicKey(hdkey.publicKey);
}

function pkh_to_avax_address(pkh) {
  return "X-" + BinTools.avaSerialize(pkh);
}

// Convert a 'hdkey' (from the library of the same name) to an AVAX address.
function hdkey_to_avax_address(hdkey) {
  return pkh_to_avax_address(hdkey_to_pkh(hdkey));
}

async function sum_child_balances(avm, hdkey) {
  var index = 0;
  var balance = new BN(0);
  var all_unused = false;
  while (!all_unused) {
    // getUTXOs is slow, so we generate INDEX_RANGE addresses at a time and batch them
    batch_addresses = [];
    batch_pkhs = [];
    for (var i = 0; i < INDEX_RANGE; i++) {
      const child = hdkey.deriveChild(index + i);
      const pkh = hdkey_to_pkh(child);
      batch_pkhs.push(pkh);
      const address = pkh_to_avax_address(pkh);
      batch_addresses.push(address);
    }
    // Get UTXOs for this batch
    const batch_utxoset = await avm.getUTXOs(batch_addresses).catch(log_error_and_exit);
    // Total the balance for all PKHs
    const batch_balance = await batch_utxoset.getBalance(batch_pkhs, AVAX_ASSET_ID_SERIALIZED);

    balance = balance.add(batch_balance);
    all_unused = batch_utxoset.getAllUTXOs().length === 0;
    index = index + INDEX_RANGE;
  }
  return balance;
}

program
  .command("get-wallet-balance")
  .description("Get the total balance of all accounts from this wallet")
  .add_node_option()
  .action(async options => {
    const ava = ava_js_with_node(options.node);
    const avm = ava.AVM();
    const extended_public_key = get_extended_public_key();
    const root_key = HDKey.fromExtendedKey(extended_public_key);
    const change_balance = await sum_child_balances(avm, root_key.deriveChild(0));
    const non_change_balance = await sum_child_balances(avm, root_key.deriveChild(1));
    console.log(change_balance.add(non_change_balance).toString());
});

program
  .command("get-change-address")
  .description("Get the first unused change address")
  .add_node_option()
  .action(async options => {
    const avm = ava_js_with_node(options.node).AVM();
    let result = await get_change_address(avm, true);
    console.log(result);
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
  // TODO pass the real path in
  path = AVA_BIP32_PREFIX + "0'/0/0";
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
  .add_node_option()
  .action(async options => {
    const avm = ava_js_with_node(options.node).AVM();

    const toAddress = options.to;
    const fromAddress = options.from;
    const changeAddress = await get_change_address(avm);
    const amount = parse_amount(options.amount);

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
