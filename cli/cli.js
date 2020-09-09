#!/usr/bin/env node

// Required by ledgerjs
require("babel-polyfill");

const BipPath = require('bip32-path');
const HDKey = require('hdkey');
const createHash = require('create-hash');
const BN = require("bn.js");
const URI = require("urijs");
const commander = require("commander");
const AvaJS = require("avalanche");
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const TransportSpeculos = require("@ledgerhq/hw-transport-node-speculos").default;
const Ledger = require("@ledgerhq/hw-app-avalanche").default;

const BinTools = AvaJS.BinTools.getInstance();
const bech32 = require('bech32');

const AVA_BIP32_PREFIX = "m/44'/9000'/0'" // Restricted to 0' for now
const INDEX_RANGE = 20; // a gap of at least 20 indexes is needed to claim an index unused
const SCAN_SIZE = 70; // the total number of utxos to look at initially to calculate last index

// TODO replace this with something better
function log_error_and_exit(err) {
  if (err.message === undefined) {
    console.error(err);
  } else {
    console.error(err.stack);
    console.error(err.message);
  }
  process.exit(1);
}

// Convenience function to add the --device option
commander.Command.prototype.add_device_option = function() {
  return this
    .option("--device <device>", "device to use")
    .option("--wallet <wallet-id>", "use a device with this wallet ID")
    .option("--speculos <apdu-port>", "(for testing) use the Ledger Speculos transport instead of connecting via USB and connect over the given port to communicate APDUs; overrides --device", parseInt)
    .option("--speculos-button-port <port>", "(requires --speculos) use the given port for automatically interacting with speculos buttons", parseInt)
    .option("--speculos-automation-port <port>", "(requires --speculos) use the given port for automatically interacting with speculos screens", parseInt)
  ;
}

commander.Command.prototype.add_network_option = function() {
  return this.requiredOption("--network <network>", "network name [denali, everest, local]", "everest");
}

// Convenience function to add the --node option
commander.Command.prototype.add_node_option = function() {
  return this
    .requiredOption("-n, --node <uri>", "node to use (use 'https://testapi.avax.network' for test network)", "https://testapi.avax.network")
    .add_network_option();
}

function get_network_id_from_hrp(hrp) {
  const network_id = AvaJS.utils.HRPToNetworkID[hrp];
  if (network_id === undefined) throw "Network " + hrp + " is not recognized";
  return network_id;
}

function ava_js_from_options(options) {
  const uri = URI(options.node);
  const network_id = get_network_id_from_hrp(options.network);
  return new AvaJS.Avalanche(uri.hostname(), uri.port(), uri.protocol(), network_id);
}

async function get_transport_with_wallet(devices, open, chosen_device, wallet_id) {
  let found_device = null;
  // If the user doesn't specify a wallet, just use the given device.
  // If they don't specify a device, this will be set to undefined, and 'open'
  // will connect to the first one.
  if (wallet_id === undefined) {
    found_device = chosen_device;
  } else {
    // If the user specifies a particular device, only check that one
    devices = chosen_device === undefined ? devices : [chosen_device];
    console.error("Finding device with wallet ID", wallet_id);
    for (const i in devices) {
      const device = devices[i];
      process.stderr.write(device + " ");

      const transport = await open(device);
      if (transport === undefined) continue;
      try {
        const ledger = new Ledger(transport, logger=console.error);
        const device_wallet_id = await ledger.getWalletId().catch(_ => console.error("[Skipped: Couldn't get wallet ID]"));
        if (device_wallet_id == undefined) continue;
        const device_wallet_id_hex = device_wallet_id.toString('hex');
        process.stderr.write(device_wallet_id_hex);
        if (device_wallet_id_hex == wallet_id) {
          console.error(" [Chosen]");
          found_device = device;
          break;
        } else {
          console.error(" [Skipped: Different wallet ID]");
        }
      } catch (e) {
        console.error("[Skipped: Couldn't connect]");
      } finally {
        transport.close();
      }
    }
  }
  if (found_device === null) {
    throw "No device found with wallet ID " + wallet_id;
  } else {
    return found_device;
  }
}

function automationEnabled(options) {
  return options.speculosAutomationPort && options.speculosButtonPort;
}

async function makeWithTransport(options) {
  const speculosOpts = {
    apduPort: options.speculos,
    buttonPort: options.speculosButtonPort,
    automationPort: options.speculosAutomationPort,
  };
  const [open, found_device] = options.speculos === undefined
    ? [TransportNodeHid.open, await get_transport_with_wallet(await TransportNodeHid.list(), TransportNodeHid.open, options.device, options.wallet)]
    : [TransportSpeculos.open, await get_transport_with_wallet([speculosOpts], TransportSpeculos.open, speculosOpts, options.wallet)];
  return async f => {
    const transport = await open(found_device);
    return await f(transport).finally(() => transport.close());
  }
}

async function withLedger(options, f) {
  const withTransport = await makeWithTransport(options);
  return await withTransport(async transport => {
    return await f(new Ledger(transport, logger=console.error));
  });
}

function requestLedgerAccept() {
  console.error("Please accept the prompt on your Ledger device.");
}

const program = new commander.Command();

program.version("0.0.1");

program
  .command("list-devices")
  .description("List all connected Ledger devices")
  .action(async () => {
  console.log(await TransportNodeHid.list());
});

program
  .command("get-app-details")
  .description("Get details about the running Ledger app")
  .add_device_option()
  .action(async (options) => {
    return await withLedger(options, async ledger => {
      const appDetails = await ledger.getAppConfiguration();
      console.log(appDetails.name + " " + appDetails.version + " (commit " + appDetails.commit + ")");
    });
});

program
  .command("get-device-model")
  .description("Get the device model of the connected ledger")
  .add_device_option()
  .action(async (options) => {
    return await (await makeWithTransport(options))(async transport => {
      console.log(transport.deviceModel);
    });
});

program
  .command("get-wallet-id")
  .add_device_option()
  .action(async (options) => {
    return await withLedger(options, async ledger => {
      const result = await ledger.getWalletId();
      console.log(result.toString("hex"));
    });
});

program
  .command("get-address <path>")
  .description("get the address of a derivation path. <path> should be 'change/address_index'")
  .add_device_option()
  .add_network_option()
  .action(async (path, options) => {
    get_network_id_from_hrp(options.network); // validate the network
    return await withLedger(options, async ledger => {
      // BIP32: m / purpose' / coin_type' / account' / change / address_index
      path = AVA_BIP32_PREFIX + "/" + path;
      console.error("Getting public key for path", path);
      requestLedgerAccept();

      if (automationEnabled(options)) flowAccept(ledger.transport);
      const pubk_hash = await ledger.getWalletAddress(path, options.network);

      const base32_hash = bech32.toWords(pubk_hash);
      const address = bech32.encode(options.network, base32_hash);
      console.log("X-" + address);
    });
});

program
  .command("get-extended-public-key <path>")
  .description("get the extended public key of a derivation path. <path> should be 'change/address_index'")
  .add_device_option()
  .action(async (path, options) => {
    return await withLedger(options, async ledger => {
      // BIP32: m / purpose' / coin_type' / account' / change / address_index
      path = AVA_BIP32_PREFIX + "/" + path;
      console.error("Getting extended public key for path", path);
      const result = await get_extended_public_key(ledger, path);
      console.log(result.publicExtendedKey);
    });
});

async function get_extended_public_key(ledger, deriv_path) {
  requestLedgerAccept();
  extended_public_key = await ledger.getWalletExtendedPublicKey(deriv_path);
  hdw = new HDKey();
  hdw.publicKey = extended_public_key.public_key;
  hdw.chainCode = extended_public_key.chain_code;
  return hdw;
}

// Scan addresses and find the first unused address (i.e. the first with no UTXOs)
async function get_first_unused_address(ava, hdkey) {
  var utxoset = new AvaJS.avm.UTXOSet();
  var addresses = [];
  var pkhs = [];
  var change_addresses = [];
  var change_pkhs = [];

  await traverse_used_keys(ava, hdkey, batch => {
    utxoset = utxoset.union(batch.utxoset);
    addresses = addresses.concat(batch.non_change.addresses);
    pkhs = pkhs.concat(batch.non_change.pkhs);
    change_addresses = change_addresses.concat(batch.change.addresses);
    change_pkhs = change_pkhs.concat(batch.change.pkhs);
  });

  // Go backwards through the generated addresses to find the last unused address
  last_unused = null;
  for (var i = addresses.length - 1; i >= 0; i--) {
    const pkh = pkhs[i].toString('hex');
    const utxoids = utxoset.addressUTXOs[pkh];
    const change_pkh = change_pkhs[i].toString('hex');
    const change_utxoids = utxoset.addressUTXOs[change_pkh];
    if (utxoids === undefined && change_utxoids === undefined) {
      last_unused = {
        non_change: addresses[i],
        change: change_addresses[i],
      };
    } else {
      break;
    }
  };

  return last_unused;
}

function hdkey_to_pkh(hdkey) {
  return (new AvaJS.common.SECP256k1KeyPair()).addressFromPublicKey(hdkey.publicKey);
}

function pkh_to_avax_address(ava, pkh) {
  return "X-" + bech32.encode(ava.hrp, bech32.toWords(pkh));
}

// Traverse children of a hdkey with the given function. Stops when at least
// INDEX_RANGE addresses are "unused" (right now, this means they have no UTXOs)
// TODO check TX history too to determine unused status
async function traverse_used_keys(ava, hdkey, batched_function) {
  // getUTXOs is slow, so we generate INDEX_RANGE addresses at a time and batch them
  // Only when INDEX_RANGE addresses have no UTXOs do we assume we are done
  const avm = ava.XChain();
  var index = 0;
  var all_unused = false;
  while (!all_unused || index < SCAN_SIZE) {
    const batch = {
      address_to_path: {}, // A dictionary from AVAX address to path (change/address)
      non_change: { addresses: [], pkhs: []},
      change: { addresses: [], pkhs: []},
    };
    for (var i = 0; i < INDEX_RANGE; i++) {
      const child = hdkey.deriveChild(0).deriveChild(index + i);
      const change_child = hdkey.deriveChild(1).deriveChild(index + i);
      const pkh = hdkey_to_pkh(child);
      const change_pkh = hdkey_to_pkh(change_child);
      batch.non_change.pkhs.push(pkh);
      batch.change.pkhs.push(change_pkh);
      const address = pkh_to_avax_address(ava, pkh);
      const change_address = pkh_to_avax_address(ava, change_pkh);
      batch.non_change.addresses.push(address);
      batch.change.addresses.push(change_address);
      batch.address_to_path[address] = "0/" + (index + i);
      batch.address_to_path[change_address] = "1/" + (index + i);
    }

    // Get UTXOs for this batch
    batch.utxoset = await avm.getUTXOs(batch.non_change.addresses.concat(batch.change.addresses));

    // Run the batch function
    batched_function(batch);

    index = index + INDEX_RANGE;
    all_unused = batch.utxoset.getAllUTXOs().length === 0;
  }
}

// Given a hdkey (at the account level), sum the UTXO balances
// under that key.
async function sum_child_balances(ava, hdkey, log = false) {
  var balance = new BN(0);

  await traverse_used_keys(ava, hdkey, async batch => {
    // Total the balance for all PKHs
    for (const [pkh, utxoids] of Object.entries(batch.utxoset.addressUTXOs)) {
      var bal = new BN(0);
      for (const utxoid of Object.keys(utxoids)) {
        bal = bal.add(batch.utxoset.utxos[utxoid].getOutput().getAmount());
      }
      if (log) {
        const addr = pkh_to_avax_address(ava, Buffer.from(pkh, 'hex'));
        console.error(batch.address_to_path[addr], addr, bal.toString());
      }
      balance = balance.add(bal);
    };
  });

  return balance;
}

// Given a hdkey (at the change or non-change level), get the full UTXO set for
// all addresses under that key. This also returns the addresses in path index
// order, and a dictionary for getting path index from UTXOID. This dictionary
// is used for determining which paths to sign via the ledger.
async function prepare_for_transfer(ava, hdkey) {
  var utxoset = new AvaJS.avm.UTXOSet();
  var addresses = [];
  var change_addresses = [];
  var addr_to_path = {};

  await traverse_used_keys(ava, hdkey, batch => {
    addr_to_path = Object.assign(addr_to_path, batch.address_to_path);
    utxoset = utxoset.union(batch.utxoset);
    addresses = addresses.concat(batch.non_change.addresses);
    change_addresses = change_addresses.concat(batch.change.addresses);
  });

  return {
    utxoset: utxoset,
    // We build the from addresses from all discovered change addresses,
    // followed by all discovered non-change addresses. This matches the web
    // wallet.
    // buildBaseTx will filter down to the minimum requirement in the order of
    // this array (and it is ordered by increasing path index).
    addresses: change_addresses.concat(addresses),
    addr_to_path: addr_to_path
  }
}

program
  .command("get-balance [address]")
  .option("--list-addresses", "Display a breakdown for individual addresses")
  .description("Get the AVAX balance of this wallet or a particular address")
  .add_node_option()
  .add_device_option()
  .action(async (address, options) => {
    const ava = ava_js_from_options(options);

    if (address === undefined) {
      await withLedger(options, async ledger => {

        if (automationEnabled(options)) flowAccept(ledger.transport);
        const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
        const balance = await sum_child_balances(ava, root_key, options.listAddresses);
        console.log(balance.toString());
      });
    } else {
      let result = await ava.XChain().getBalance(address,
        BinTools.cb58Encode(await ava.XChain().getAVAXAssetID())
      );
      console.log(result.balance.toString(10, 0));
    }
});

program
  .command("get-new-receive-address")
  .description("Get a fresh address for receiving funds")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      let result = await get_first_unused_address(ava, root_key, true);
      console.log(result.non_change);
    });
});

/* Adapted from avm/tx.ts for class UnsignedTx */
async function sign_UnsignedTx(ava, unsignedTx, addr_to_path, ledger) {
  const txbuff = unsignedTx.toBuffer();
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, baseTx, hash, addr_to_path, ledger);
  return new AvaJS.avm.Tx(unsignedTx, sigs);
}

/* Adapted from avm/tx.ts for class BaseTx */
async function sign_BaseTx(ava, baseTx, hash, addr_to_path, ledger) {
  let path_suffixes = new Set();
  for (let i = 0; i < baseTx.ins.length; i++) {
    const sigidxs = baseTx.ins[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      path_suffixes.add(addr_to_path[pkh_to_avax_address(ava, sigidxs[j].getSource())]);
    }
  }

  const path_suffix_to_sig_map = await sign_with_ledger(ledger, hash, path_suffixes);

  const sigs = [];
  for (let i = 0; i < baseTx.ins.length; i++) {
    const cred = AvaJS.avm.SelectCredentialClass(baseTx.ins[i].getInput().getCredentialID());
    const sigidxs = baseTx.ins[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      const path_suffix = addr_to_path[pkh_to_avax_address(ava, sigidxs[j].getSource())];
      const signval = path_suffix_to_sig_map.get(path_suffix);
      if (signval === undefined) throw "Unable to find signature for " + path_suffix;
      const sig = new AvaJS.common.Signature();
      sig.fromBuffer(signval);
      cred.addSignature(sig);
    }
    sigs.push(cred);
  }

  return sigs;
}

async function sign_with_ledger(ledger, hash, path_suffixes) {
  const path_suffixes_arr = Array.from(path_suffixes);
  console.error("Signing hash", hash.toString('hex').toUpperCase(), "with paths", path_suffixes_arr);
  requestLedgerAccept();
  const path_suffix_to_sig = await ledger.signHash(
    BipPath.fromString(AVA_BIP32_PREFIX), path_suffixes_arr.map(x => BipPath.fromString(x, false)), hash
  ).catch(log_error_and_exit);

  console.error("Signatures:");
  path_suffix_to_sig.forEach((value, key) => {
    console.error(" ", key + ":", value.toString("hex"));
  });

  return path_suffix_to_sig;
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
  .description("Transfer AVAX between addresses")
  .requiredOption("--amount <amount>", "Amount to transfer, specified in nanoAVAX")
  .requiredOption("--to <account>", "Recipient account")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const avm = ava.XChain();
    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, root_key);

      const amount = parse_amount(options.amount);
      const toAddress = options.to;
      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const changeAddress = (await get_first_unused_address(ava, root_key)).change;

      console.error("Building TX...");

      const unsignedTx = await avm.buildBaseTx(prepared.utxoset, amount, BinTools.cb58Encode(await avm.getAVAXAssetID()), [toAddress], fromAddresses, [changeAddress]);
      console.error("Unsigned TX:");
      console.error(unsignedTx.toBuffer().toString("hex"));
      const signed = await sign_UnsignedTx(ava, unsignedTx, prepared.addr_to_path, ledger);
      console.error("Issuing TX...");
      const txid = await avm.issueTx(signed);
      console.log(txid);
    });
});

// For automated testing
function flowAccept(speculos, n) {
  console.error("Automatically accepting prompt.")
  return new Promise(r => {
    var prompts = [{}];
    var subscript = speculos.automationEvents.subscribe({
      next: evt => {
        if (evt.y === 3) {
          let m = evt.text.match(/^(.*) \(([0-9])\/([0-9])\)$/)
          if (m) {
            isFirst = m[2] === '1';
            isLast = m[2] === m[3];
            evt.text = m[1];
          } else {
            isFirst = true;
            isLast = true;
          }
        }
        if (isFirst) {
          prompts[prompts.length-1][evt.y] = evt.text;
        } else if (evt.y !== 3) {
          prompts[prompts.length-1][evt.y] = prompts[prompts.length-1][evt.y] + evt.text;
        }
        if (evt.y !== 3 && isLast) prompts.push({});
        if (evt.text !== "Accept") {
          if (evt.y !== 3) speculos.button("Rr");
        } else {
          speculos.button("RLrl");
          subscript.unsubscribe();
          r(prompts.slice(-(n+3), -3));
        }
      }
    });
  });
}

async function main() {
  return await program.parseAsync(process.argv).catch(log_error_and_exit);
}

main();
