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
const Ledger = require("@obsidiansystems/hw-app-avalanche").default;

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
  return this.requiredOption("--network <network>", "network name [avax, fuji, local]", "avax");
}

// Convenience function to add the --node option
commander.Command.prototype.add_node_option = function() {
  return this
    .requiredOption("-n, --node <uri>", "node to use (avax mainnet defaults to 'https://api.avax.network', fuji defaults to 'https://api.avax-test.network', local defaults to 'http://localhost:9650')", "network-default-node")
    .add_network_option();
}

const network_default_node = {
  "avax" : "https://api.avax.network",
  "fuji" : "https://api.avax-test.network",
  "local" : "http://localhost:9650",
};

function get_network_node(options) {
  return (options.node === "network-default-node" ? network_default_node[options.network] : options.node);
}

commander.Command.prototype.add_chain_option = function() {
  return this
    .option("--chain <chain>", "chain [" + AvaJS.utils.XChainAlias + ", " + AvaJS.utils.PChainAlias + "]", AvaJS.utils.XChainAlias);
}

function get_network_id_from_hrp(hrp) {
  const network_id = AvaJS.utils.HRPToNetworkID[hrp];
  if (network_id === undefined) throw "Network " + hrp + " is not recognized";
  return network_id;
}

function ava_js_from_options(options) {
  const uri = URI(get_network_node(options));
  const network_id = get_network_id_from_hrp(options.network);
  return new AvaJS.Avalanche(uri.hostname(), uri.port(), uri.protocol(), network_id);
}

function make_chain_objects(ava, alias) {
  switch (alias) {
    case AvaJS.utils.XChainAlias:
      return ({ "vm": AvaJS.avm, "api": ava.XChain(), "alias" : AvaJS.utils.XChainAlias });
    case AvaJS.utils.PChainAlias:
      return ({ "vm": AvaJS.platformvm, "api": ava.PChain(), "alias" : AvaJS.utils.PChainAlias });
    default:
      log_error_and_exit("Unsupported chain alias");
  }
}

// Convert chain alias to their counterpart, i.e. X -> P, P -> X
function swap_chain_alias(alias) {
  switch (alias) {
    case AvaJS.utils.XChainAlias: return AvaJS.utils.PChainAlias;
    case AvaJS.utils.PChainAlias: return AvaJS.utils.XChainAlias;
    default: log_error_and_exit("Unsupported chain alias");
  }
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
  .add_node_option()
  .add_chain_option()
  .action(async (path, options) => {
    get_network_id_from_hrp(options.network); // validate the network
    const ava = ava_js_from_options(options);
    const chain_objects = make_chain_objects(ava, options.chain);
    return await withLedger(options, async ledger => {
      // BIP32: m / purpose' / coin_type' / account' / change / address_index
      path = AVA_BIP32_PREFIX + "/" + path;
      console.error("Getting public key for path", path);
      requestLedgerAccept();

      if (automationEnabled(options)) flowAccept(ledger.transport);
      const pubk_hash = await ledger.getWalletAddress(path, options.network);

      console.log(pkh_to_some_address(ava, chain_objects.alias, pubk_hash));
    });
});

program
  .command("get-extended-public-key [path]")
  .description("get the extended public key of a derivation path. <path> should be 'change/address_index'")
  .add_device_option()
  .action(async (path, options) => {
    return await withLedger(options, async ledger => {
      // BIP32: m / purpose' / coin_type' / account' / change / address_index
      path = AVA_BIP32_PREFIX + (path === undefined ? "" : "/" + path);
      console.error("Getting extended public key for path", path);
      if (automationEnabled(options)) flowAccept(ledger.transport);
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
async function get_first_unused_address(ava, chain_objects, hdkey) {
  var utxoset = new chain_objects.vm.UTXOSet();
  var addresses = [];
  var pkhs = [];
  var change_addresses = [];
  var change_pkhs = [];

  await traverse_used_keys(ava, chain_objects, hdkey, batch => {
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

function pkh_to_some_address(ava, alias, pkh) {
  return alias + "-" + bech32.encode(ava.hrp, bech32.toWords(pkh));
}

// Traverse children of a hdkey with the given function. Stops when at least
// INDEX_RANGE addresses are "unused" (right now, this means they have no UTXOs)
// TODO check TX history too to determine unused status
async function traverse_used_keys(ava, chain_objects, hdkey, batched_function) {
  // getUTXOs is slow, so we generate INDEX_RANGE addresses at a time and batch them
  // Only when INDEX_RANGE addresses have no UTXOs do we assume we are done
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
      const address = pkh_to_some_address(ava, chain_objects.alias, pkh);
      const change_address = pkh_to_some_address(ava, chain_objects.alias, change_pkh);
      batch.non_change.addresses.push(address);
      batch.change.addresses.push(change_address);
      batch.address_to_path[address] = "0/" + (index + i);
      batch.address_to_path[change_address] = "1/" + (index + i);
    }

    // Get UTXOs for this batch
    batch.utxoset = await (await chain_objects.api.getUTXOs(batch.non_change.addresses.concat(batch.change.addresses))).utxos;

    // Run the batch function
    batched_function(batch);

    index = index + INDEX_RANGE;
    all_unused = batch.utxoset.getAllUTXOs().length === 0;
  }
}

// Given a hdkey (at the account level), sum the UTXO balances
// under that key.
async function sum_child_balances(ava, chain_objects, hdkey, log = false) {
  var balance = new BN(0);

  await traverse_used_keys(ava, chain_objects, hdkey, async batch => {
    // Total the balance for all PKHs
    for (const [pkh, utxoids] of Object.entries(batch.utxoset.addressUTXOs)) {
      var bal = new BN(0);
      for (const utxoid of Object.keys(utxoids)) {
        bal = bal.add(batch.utxoset.utxos[utxoid].getOutput().getAmount());
      }
      if (log) {
        const addr = pkh_to_some_address(ava, chain_objects.alias, Buffer.from(pkh, 'hex'));
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
async function prepare_for_transfer(ava, chain_objects, hdkey) {
  var utxoset = new chain_objects.vm.UTXOSet();
  var addresses = [];
  var change_addresses = [];
  var addr_to_path = {};

  await traverse_used_keys(ava, chain_objects, hdkey, batch => {
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
  .add_chain_option()
  .action(async (address, options) => {
    const ava = ava_js_from_options(options);
    const chain_objects = make_chain_objects(ava, options.chain);
    if (address === undefined) {
      await withLedger(options, async ledger => {

        if (automationEnabled(options)) flowAccept(ledger.transport);
        const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
        const balance = await sum_child_balances(ava, chain_objects, root_key, options.listAddresses);
        console.log(balance.toString() + " nAVAX");
      });
    } else {
      var result;
      switch (address.split("-")[0]) {
        case AvaJS.utils.XChainAlias:
          result = (await ava.XChain().getBalance(address,
            BinTools.cb58Encode(await ava.XChain().getAVAXAssetID())
          )).balance;
          break;
        case AvaJS.utils.PChainAlias:
          result = (await ava.PChain().getBalance(address,
            BinTools.cb58Encode(await ava.PChain().getAVAXAssetID())
          )).balance;
          break;
        default:
          console.error("Unrecognised address format");
          return;
      }
      console.log(result.toString(10, 0) + " nAVAX");
    }
});

program
  .command("get-new-receive-address")
  .description("Get a fresh address for receiving funds")
  .add_node_option()
  .add_device_option()
  .add_chain_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const chain_objects = make_chain_objects(ava, options.chain);
    return await withLedger(options, async ledger => {
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      let result = await get_first_unused_address(ava, chain_objects, root_key, true);
      console.log(result.non_change);
    });
});

/* Adapted from avm/tx.ts for class UnsignedTx */
async function sign_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options))
      await flowMultiPrompt(ledger.transport);
    const result = await ledger.signTransaction(prefix, suffixes, buff);
    return result.signatures;
  }, options, ledger);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, hash, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options)) flowAccept(ledger.transport);
    const result = await ledger.signHash(prefix, suffixes, buff);
    return result
  }, options, ledger);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

async function sign_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options))
      await flowMultiPrompt(ledger.transport);
    const result = await ledger.signTransaction(prefix, suffixes, buff);
    return result.signatures;
  }, options, ledger);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, hash, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options)) flowAccept(ledger.transport);
    const result = await ledger.signHash(prefix, suffixes, buff);
    return result
  }, options, ledger);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}


/* Adapted from avm/tx.ts for class BaseTx */
async function sign_BaseTx(ava, chain_objects, inputs, txbuff, addr_to_path, ledgerSign, options, ledger) {
  let path_suffixes = new Set();
  for (let i = 0; i < inputs.length; i++) {
    const sigidxs = inputs[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      path_suffixes.add(addr_to_path[pkh_to_some_address(ava, chain_objects.alias, sigidxs[j].getSource())]);
    }
  }

  const path_suffix_to_sig_map = await sign_with_ledger(ledgerSign, txbuff, path_suffixes, options, ledger);

  const sigs = [];
  for (let i = 0; i < inputs.length; i++) {
    const cred = chain_objects.vm.SelectCredentialClass(inputs[i].getInput().getCredentialID());
    const sigidxs = inputs[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      const path_suffix = addr_to_path[pkh_to_some_address(ava, chain_objects.alias, sigidxs[j].getSource())];
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

async function sign_with_ledger(ledgerSign, txbuff, path_suffixes, options, ledger) {
  const path_suffixes_arr = Array.from(path_suffixes);
  console.error("Signing transaction", txbuff.toString('hex').toUpperCase(), "with paths", path_suffixes_arr);
  requestLedgerAccept();
  const path_suffix_to_sig = await ledgerSign(
    BipPath.fromString(AVA_BIP32_PREFIX), path_suffixes_arr.map(x => BipPath.fromString(x, false)), txbuff
  ).catch(log_error_and_exit);

  console.error("Signatures:");
  path_suffix_to_sig.forEach((value, key) => {
    console.error(" ", key + ":", value.toString("hex"));
  });

  return path_suffix_to_sig;
}

function parseAmountWithError(str) {
  const amount = parseAmount(str);
  if (amount === false) {
    console.error("Couldn't parse the given amount.");
    console.error("Amounts can be specified with units, and missing units will be treated as AVAX:");
    console.error("   100     -> 100 AVAX");
    console.error("   1.5AVAX -> 1,500,000,000 nanoAVAX");
    console.error("   25nAVAX -> 25 nanoAVAX");
    console.error("nanoAVAX amounts must be whole integers, and AVAX amounts can't be specified past 9 decimal places.");
    process.exit(1);
  } else {
    return amount;
  }
}

// Amount returned is in nanoAVAX. Returns 'false' if parsing failed for any
// reason. Defaults to AVAX if no units are given.
function parseAmount(str) {
  if (str.length === 0) return false;
  var pastDecimal = false;
  var integerPart = "";
  var fractionalPart = "";
  var remainingString = "";
  for (var i = 0; i < str.length; i++) {
    const c = str.charAt(i);
    if (c >= "0" && c <= "9") {
      if (pastDecimal) {
        fractionalPart += c
      } else {
        integerPart += c
      }
    } else if ((c == "." || c == ",") && !pastDecimal) {
      pastDecimal = true;
    } else if (c == " ") {
      // ignore space between number and units
    } else {
      remainingString = str.slice(i);
      break;
    }
  }
  switch (remainingString) {
    case "nAVAX":
    case "nanoAVAX":
      if (fractionalPart === "") {
        return new BN(integerPart)
      } else {
        return false;
      }
      break;
    case "AVAX":
    case "":
      const mkExp = n => (new BN(10)).pow(new BN(n));
      const i = (new BN(integerPart)).mul(mkExp(9));
      const exponent = 9 - fractionalPart.length;
      if (exponent < 0) return false; // Specified more precision than AVAX can hold
      const f = new BN(fractionalPart).mul(mkExp(exponent));
      return i.add(f);
      break;
    default:
      return false;
  }
}

function parseVersion(str) {
  parts = str.split(".");
  if (parts.length == 3) {
    return {
      "major": parseInt(parts[0]),
      "minor": parseInt(parts[1]),
      "patch": parseInt(parts[2]),
    }
  } else {
    console.error("Warning: couldn't get the ledger app version")
    return {
      "major": 0,
      "minor": 0,
      "patch": 0,
    }
  }
}

async function getParsedVersion(ledger, version) {
  const appDetails = await ledger.getAppConfiguration();
  return parseVersion(appDetails.version);
}

program
  .command("transfer")
  .description("Transfer AVAX between addresses")
  .requiredOption("--amount <amount>", "Amount to transfer, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .requiredOption("--to <account>", "Recipient account")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const chain_objects = make_chain_objects(ava, toAddress.split("-")[0]);
    if (chain_objects.alias !== AvaJS.utils.XChainAlias)
      log_error_and_exit("Transfers are only possible on the " + AvaJS.utils.XChainAlias + " chain. If you are looking to transfer between chains, see `export`.")
    const amount = parseAmountWithError(options.amount);

    return await withLedger(options, async ledger => {
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const version = await getParsedVersion(ledger);
      const signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTx : sign_UnsignedTx

      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, chain_objects, root_key);

      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const changeAddress = (await get_first_unused_address(ava, chain_objects, root_key)).change;

      console.error("Building TX...");

      const unsignedTx = await chain_objects.api.buildBaseTx(
        prepared.utxoset,
        amount,
        BinTools.cb58Encode(await chain_objects.api.getAVAXAssetID()),
        [toAddress],
        fromAddresses,
        [changeAddress]
      );
      console.error("Unsigned TX:");
      console.error(unsignedTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, chain_objects, unsignedTx, prepared.addr_to_path, ledger, options);
      console.error("Issuing TX...");
      const txid = await chain_objects.api.issueTx(signedTx);
      console.log(txid);
    });
});

program
  .command("export")
  .description("Export AVAX to another chain")
  .requiredOption("--amount <amount>", "Amount to transfer, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .requiredOption("--to <account>", "Recipient account")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const destination_chain_alias = toAddress.split("-")[0]
    const destination_chain_objects = make_chain_objects(ava, destination_chain_alias);
    const destination_chain_id = destination_chain_objects.api.getBlockchainID();
    const source_chain_alias = swap_chain_alias(destination_chain_alias);
    const source_chain_objects = make_chain_objects(ava, source_chain_alias);
    const amount = parseAmountWithError(options.amount);
    return await withLedger(options, async ledger => {
      const version = await getParsedVersion(ledger);
      signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTx : sign_UnsignedTx
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, source_chain_objects, root_key);

      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const changeAddress = (await get_first_unused_address(ava, source_chain_objects, root_key)).change;

      console.error("Building TX...");

      const unsignedExportTx = await source_chain_objects.api.buildExportTx(
        prepared.utxoset,
        amount,
        destination_chain_id,
        [toAddress],
        fromAddresses,
        [changeAddress],
      );
      console.error("Unsigned Export TX:");
      console.error(unsignedExportTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, source_chain_objects, unsignedExportTx, prepared.addr_to_path, ledger, options);
      console.error("Issuing TX...");
      const txid = await source_chain_objects.api.issueTx(signedTx);
      console.log(txid);
    });
});

program
  .command("import")
  .description("Import AVAX from a different chain")
  .requiredOption("--to <account>", "Recipient account")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const destination_chain_alias = toAddress.split("-")[0];
    const destination_chain_objects = make_chain_objects(ava, destination_chain_alias);
    return await withLedger(options, async ledger => {
      const version = await getParsedVersion(ledger);
      signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTxImport : sign_UnsignedTxImport
      
      switch (destination_chain_alias) {
        case AvaJS.utils.XChainAlias:
          source_chain_id = AvaJS.utils.PlatformChainID;
          break;
        case AvaJS.utils.PChainAlias:
          source_chain_id = ava.XChain().getBlockchainID();
          break;
      }
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, destination_chain_objects, root_key);

      const fromAddresses = [];
      const changeAddresses = [];
      console.error("Building TX...");
      const unsignedImportTx = await destination_chain_objects.api.buildImportTx(
        prepared.utxoset,
        [toAddress],
        source_chain_id,
        [toAddress],
        fromAddresses,
        changeAddresses
      );
      console.error("Unsigned Import TX:");
      console.error(unsignedImportTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, destination_chain_objects, unsignedImportTx, prepared.addr_to_path, ledger, options);
      console.error("Issuing TX...");
      const txid = await destination_chain_objects.api.issueTx(signedTx);
      console.log(txid);
    });
});

// Parse a relative date, i.e. something like: 1d15m, 1d1h, 10m
// Returns 'false' if parsing failed, otherwise returns an object with 'days',
// 'hours', and 'mins'. The keys will be missing if the user did not specify
// them.
function parseRelativeDate(str) {
  var digits = "";
  var obj = new Object();
  if (str.length === 0) return false;
  for (var i = 0; i < str.length; i++) {
    const c = str.charAt(i);
    if (c >= "0" && c <= "9") {
      digits += c;
    } else if (c === "d") {
      if (obj.days !== undefined) return false;
      if (digits === "") return false
      obj.days = parseInt(digits);
      digits = "";
    } else if (c === "h") {
      if (obj.hours !== undefined) return false;
      if (digits === "") return false
      obj.hours = parseInt(digits);
      digits = "";
    } else if (c === "m") {
      if (obj.mins !== undefined) return false;
      if (digits === "") return false
      obj.mins = parseInt(digits);
      digits = "";
    } else {
      return false;
    }
  }
  // If we have leftover digits, parsing failed
  if (digits !== "") return false;
  return obj;
}

// Parse a date like string to unix time. If the given date is relative, the
// returned time is relative to the given date "relativeTo".
function parseDateToUnixTime(str, relativeTo) {
  const relative = parseRelativeDate(str)
  if (relative === false) {
    const millis = Date.parse(str);
    if (isNaN(millis)) {
      console.error("Invalid date");
      process.exit(1);
    } else {
      return new BN(millis / 1000);
    }
  } else {
    mins = relative.mins === undefined ? 0 : relative.mins;
    hours = relative.hours === undefined ? 0 : relative.hours;
    days = relative.days === undefined ? 0 : relative.days;
    return new BN((Math.floor(relativeTo.getTime() / 1000)) + 60 * (mins + 60 * (hours + 24 * days)));
  }
}

program
  .command("validate")
  .description("Add a validator")
  .requiredOption("--amount <amount>", "Amount to stake, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .option("--start-time <time>", "Start time, relative to now (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "10m")
  .option("--end-time <time>", "End time, relative to the start time (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "365d")
  .option("--reward-address <address>", "P-Chain address the rewards should be delivered to. If not provided, the next receiving address is used.")
  .requiredOption("--delegation-fee <fee>", "Delegation fee, percent")
  .requiredOption("--node-id <node-id>", "The NodeID to be used in validating")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options)
    const chain_objects = make_chain_objects(ava, AvaJS.utils.PChainAlias);
    const startTime = parseDateToUnixTime(options.startTime, new Date());
    const twoWeeksFromNow = Math.floor(Date.now() / 1000 + 14 * (24 * 60 * 60))
    if (startTime > twoWeeksFromNow) {
      log_error_and_exit("Start time must be within two weeks from now");
    }
    const endTime = parseDateToUnixTime(options.endTime, new Date());

    //Enforce min/max for end of validating period

    const oneYearFromStart = startTime.add(new BN(365 * (24 * 60 * 60)));
    const twoWeeksFromStart = startTime.add(new BN(14 * (24 * 60 * 60)));
    if (endTime > oneYearFromStart) {
        log_error_and_exit("End time cannot be more than 1 year from start");
    } else if (endTime < twoWeeksFromStart) {
        log_error_and_exit("End time cannot be less than 2 weeks from start");
    }
    const stakeAmount = parseAmountWithError(options.amount);
    const nodeId = options.nodeId;
    const delegationFee = Number.parseFloat(options.delegationFee);
    if (delegationFee < 2) {
      console.error("The minimum delegation fee is 2%.");
      process.exit(1);
    } else if (delegationFee > 100) {
      console.error("The delegation fee cannot be higher than 100%.");
      process.exit(1);
    }
    return await withLedger(options, async ledger => {
      const version = await getParsedVersion(ledger);
      const signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTx : sign_UnsignedTx
      
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, chain_objects, root_key);

      // These are the staking addresses
      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const unusedAddresses = await get_first_unused_address(ava, chain_objects, root_key);
      const changeAddress = unusedAddresses.change;
      // Rewards go to the staking addresses unless otherwise specified
      const rewardAddresses = options.rewardAddress === undefined ? [unusedAddresses.non_change] : [options.rewardAddress];

      console.error("Building TX...");

      const unsignedAddValidatorTx = await chain_objects.api.buildAddValidatorTx(
        prepared.utxoset,
        rewardAddresses, // Can't use fromAddresses here, that results in a "to" of hundreds of addresses.
        fromAddresses,
        [changeAddress],
        nodeId,
        startTime,
        endTime,
        stakeAmount,
        rewardAddresses,
        delegationFee,
      );
      console.error("Unsigned Add Validator TX:");
      console.error(unsignedAddValidatorTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, chain_objects, unsignedAddValidatorTx, prepared.addr_to_path, ledger, options);
      console.error("Issuing TX...");
      const txid = await chain_objects.api.issueTx(signedTx);
      console.log(txid);
  });
});

program
  .command("delegate")
  .description("Delegate stake to a validator")
  .requiredOption("--amount <amount>", "Amount to stake, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .option("--start <time>", "Start time, relative to now (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "10m")
  .option("--end <time>", "End time, relative to the start time (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "365d")
  .option("--reward-address <address>", "P-Chain address the rewards should be delivered to. If not provided, the next receiving address is used.")
  .requiredOption("--node-id <node-id>", "ID of the node to delegate to")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options)
    const chain_objects = make_chain_objects(ava, AvaJS.utils.PChainAlias);
    const startTime = parseDateToUnixTime(options.startTime, new Date());
    const twoWeeksFromNow = Math.floor(Date.now() / 1000 + 14 * (24 * 60 * 60))
    if (startTime > twoWeeksFromNow) {
      log_error_and_exit("Start time must be within two weeks from now");
    }
    const endTime = parseDateToUnixTime(options.endTime, new Date());

    //Enforce min/max for end of delegating period

    const oneYearFromStart = startTime.add(new BN(365 * (24 * 60 * 60)));
    const twoWeeksFromStart = startTime.add(new BN(14 * (24 * 60 * 60)));
    if (endTime > oneYearFromStart) {
      log_error_and_exit("End time cannot be more than 1 year from start");
    }
    if (endTime < twoWeeksFromStart) {
      log_error_and_exit("End time cannot be less than 2 weeks from start");
    }
    const stakeAmount = parseAmountWithError(options.amount);
    const nodeId = options.nodeId;
    // Preemptively reject delegations which lie outside the validator time
    // slot, because the node won't give us an error and the TX will never be
    // accepted.
    validators = await chain_objects.api.getCurrentValidators();
    validator = validators.validators.find(v => v.nodeID === nodeId)
    if (validator !== undefined) {
      validatorStartTime = new BN(validator.startTime);
      validatorEndTime = new BN(validator.endTime);
      if (startTime.lt(validatorStartTime)) {
        validatorDate = new Date(validatorStartTime.toNumber() * 1000);
        delegatorDate = new Date(startTime.toNumber() * 1000);
        log_error_and_exit("Chosen delegation start time [" + delegatorDate.toString() + "] starts before the validator start time [" + validatorDate.toString() + "].");
      }
      if (endTime.gt(validatorEndTime)) {
        validatorDate = new Date(validatorEndTime.toNumber() * 1000);
        delegatorDate = new Date(endTime.toNumber() * 1000);
        log_error_and_exit("Chosen delegation end time [" + delegatorDate.toString() + "] ends after the validator end time [" + validatorDate.toString() + "].");
      }
    }
    return await withLedger(options, async ledger => {
      const version = await getParsedVersion(ledger);
      const signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTx : sign_UnsignedTx
      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, chain_objects, root_key);

      // These are the staking addresses
      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const unusedAddresses = await get_first_unused_address(ava, chain_objects, root_key);
      const changeAddress = unusedAddresses.change;
      // Rewards go to the staking addresses unless otherwise specified
      const rewardAddresses = options.rewardAddress === undefined ? [unusedAddresses.non_change] : [options.rewardAddress];

      console.error("Building TX...");

      const unsignedAddDelegatorTx = await chain_objects.api.buildAddDelegatorTx(
        prepared.utxoset,
        rewardAddresses, // Return the staked tokens to the reward addresses.
        fromAddresses,
        [changeAddress],
        nodeId,
        startTime,
        endTime,
        stakeAmount,
        rewardAddresses,
      );
      console.error("Unsigned Add Delegator TX:");
      console.error(unsignedAddDelegatorTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, chain_objects, unsignedAddDelegatorTx, prepared.addr_to_path, ledger, options);
      console.error("Issuing TX...");
      const txid = await chain_objects.api.issueTx(signedTx);
      console.log(txid);
  });
});

program
  .command("list-validators")
  .description("List validators")
  .option("--current", "Return current validators")
  .option("--pending", "Return pending validators")
  .add_node_option()
  .action(async options => {
  const ava = ava_js_from_options(options)
  const platformapi = ava.PChain()
  const show_current = options.current || !options.pending
  const show_pending = options.pending || !options.current
  var validators = [];
  if (show_current) {
    validators = (await platformapi.getCurrentValidators()).validators;
  }
  if (show_pending) {
    validators = validators.concat((await platformapi.getPendingValidators()).validators);
  }
  validators.sort((a,b) => b.stakeAmount - a.stakeAmount);
  validators.forEach(validator => {
    console.log(validator.nodeID);
    console.log("  Stake Amount:", (validator.stakeAmount / 1000000000).toString() + " AVAX");
    console.log("  Delegation Fee:", validator.delegationFee + "%");
    console.log("  Uptime:", validator.uptime);
    console.log("  Potential Reward:", validator.potentialReward);
    console.log("  Start Time:", new Date(validator.startTime * 1000));
    console.log("  End Time:", new Date(validator.endTime * 1000));
    console.log("  Delegators:", validator.delegators === null ? 0 : validator.delegators.length);
  });
});

program
  .command("get-min-stake")
  .description("Get the minimum amount of AVAX required for validation and delegation")
  .add_node_option()
  .action(async options => {
  const ava = ava_js_from_options(options)
  const platformapi = ava.PChain()
  const min_stake = await platformapi.getMinStake();
  console.log("Min validator stake:", min_stake.minValidatorStake.toString(), "nanoAVAX");
  console.log("Min delegator stake:", min_stake.minDelegatorStake.toString(), "nanoAVAX");
});

program
  .command("get-default-fee")
  .description("Get the default TX fee for this chain")
  .add_node_option()
  .add_chain_option()
  .action(async options => {
  const ava = ava_js_from_options(options)
  const chain_objects = make_chain_objects(ava, options.chain)
  const fee = chain_objects.api.getDefaultTxFee();
  console.log(fee.toString(), "nanoAVAX");
});

program
  .command("get-fee")
  .description("Get the TX fee for this chain")
  .add_node_option()
  .add_chain_option()
  .action(async options => {
  const ava = ava_js_from_options(options)
  const chain_objects = make_chain_objects(ava, options.chain)
  const fee = chain_objects.api.getTxFee();
  console.log(fee.toString(), "nanoAVAX");
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

async function readMultiScreenPrompt(speculos, source) {
  let header;
  let body;
  let screen = await source.next();
  let m = screen.header && screen.header.match(/^(.*) \(([0-9])\/([0-9])\)$/);
  if (m) {
    header = m[1];
    body = screen.body;
    while(m[2] !== m[3]) {
      speculos.button("Rr");
      screen = await source.next();
      m = screen.header && screen.header.match(/^(.*) \(([0-9])\/([0-9])\)$/);
      body = body + screen.body;
    }
    return { header: header, body: body };
  } else {
    return screen;
  }
}

function acceptPrompts(expectedPrompts, selectPrompt, finalPrompt = selectPrompt) {
  return async (speculos, screens) => {
    if(!screens) {
      // We're running against hardware, so we can't prompt but
      // should tell the person running the test what to do.
      if (expectedPrompts) {
        console.log("Expected prompts: ");
        for (p in expectedPrompts) {
          console.log("Prompt %d", p);
          console.log(expectedPrompts[p][3]);
          console.log(expectedPrompts[p][17]);
        }
      }
      console.log("Please %s this prompt", selectPrompt);
      return { expectedPrompts, promptsMatch: true, finalDone: false }
    } else {
      let promptList = [];
      let finalDone = false;
      let done = false;
      while(!done && (screen = await readMultiScreenPrompt(speculos, screens))) {
        if(screen.body !== selectPrompt && screen.body !== finalPrompt && screen.body != "Reject") {
          promptList.push(screen);
        }
        if(screen.body !== selectPrompt && screen.body !== finalPrompt) {
          speculos.button("Rr");
        } else {
          speculos.button("RLrl");
          done = true;
          finalDone = screen.body === finalPrompt;
        }
      }

      if (expectedPrompts) {
        expect(promptList).to.deep.equal(expectedPrompts);
        return { promptList, promptsMatch: true, finalDone: finalDone };
      } else {
        return { promptList, finalDone: finalDone };
      }
    }
  }
}

const headerOnlyScreens = {
  "Configuration": 1,
  "Main menu": 1
};

async function automationStart(speculos, interactionFunc) {
  // If this doens't exist, we're running against a hardware ledger; just call
  // interactionFunc with no events iterator.
  if(!speculos.automationEvents) {
    return new Promise(r=>r({ promptsPromise: interactionFunc(speculos) }));
  }

  // This is so that you can just "await flowAccept(this.speculos);" in a test
  // without actually waiting for the prompts.  If we don't do this, you can
  // end up with two flowAccept calls active at once, causing issues.
  let subNum = speculos.handlerNum++;
  let promptLockResolve;
  let promptsLock=new Promise(r=>{promptLockResolve=r});
  if(speculos.promptsEndPromise) {
    await speculos.promptsEndPromise;
  }
  speculos.promptsEndPromise = promptsLock; // Set ourselves as the interaction.

  // Make an async iterator we can push stuff into.
  let sendEvent;
  let sendPromise=new Promise(r=>{sendEvent = r;});
  let asyncEventIter = {
    next: async ()=>{
      promptVal=await sendPromise;
      sendPromise=new Promise(r=>{sendEvent = r;});
      return promptVal;
    },
    peek: async ()=>{
      return await sendPromise;
    }
  };

  // Sync up with the ledger; wait until we're on the home screen, and do some
  // clicking back and forth to make sure we see the event.
  // Then pass screens to interactionFunc.
  let readyPromise = syncWithLedger(speculos, asyncEventIter, interactionFunc);

  // Resolve our lock when we're done
  readyPromise.then(r=>r.promptsPromise.then(()=>{promptLockResolve(true)}));

  let header;
  let body;

  let subscript = speculos.automationEvents.subscribe({
    next: evt => {
      // Wrap up two-line prompts into one:
      if(evt.y == 3 && ! headerOnlyScreens[evt.text]) {
        header = evt.text;
        return; // The top line comes out first, so now wait for the next draw.
      } else {
        body = evt.text;
      }
      screen = { ...(header && {header}), body };
      // console.log("SCREEN (" + subNum + "): " + JSON.stringify(screen));
      sendEvent(screen);
      body=undefined;
      header=undefined;
    }});

  asyncEventIter.unsubscribe = () => { subscript.unsubscribe(); };

  // Send a rightward-click to make sure we get _an_ event and our state
  // machine starts.
  speculos.button("Rr");

  return readyPromise.then(r=>{r.cancel = ()=>{subscript.unsubscribe(); promptLockResolve(true);}; return r;});
}

async function syncWithLedger(speculos, source, interactionFunc) {
  let screen = await source.next();
  // Scroll to the end; we do this because we might have seen "Avalanche" when
  // we subscribed, but needed to send a button click to make sure we reached
  // this point.
  while(screen.body != "Quit") {
    speculos.button("Rr");
    screen = await source.next();
  }
  // Scroll back to "Avalanche", and we're ready and pretty sure we're on the
  // home screen.
  while(screen.header != "Avalanche") {
    speculos.button("Ll");
    screen = await source.next();
  }
  // Sink some extra homescreens to make us a bit more durable to failing tests.
  while(await source.peek().header == "Avalanche" || await source.peek().body == "Quit") {
    await source.next();
  }
  // And continue on to interactionFunc
  let interactFP = interactionFunc(speculos, source);
  return { promptsPromise: interactFP.finally(() => { source.unsubscribe(); }) };
}

async function flowMultiPrompt(speculos, nextPrompt="Next", finalPrompt="Accept") {
  return await automationStart(speculos, async (speculos, screens) => {
    while (true) {
      const result = await acceptPrompts(undefined, nextPrompt, finalPrompt)(speculos, screens);
      if (result.finalDone) break;
    }
    return true;
  });
}

async function main() {
  return await program.parseAsync(process.argv).catch(log_error_and_exit);
}

main();
