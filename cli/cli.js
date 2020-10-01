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
  return this.requiredOption("--network <network>", "network name [avax, fuji, local]", "fuji");
}

// Convenience function to add the --node option
commander.Command.prototype.add_node_option = function() {
  return this
    .requiredOption("-n, --node <uri>", "node to use (use 'https://testapi.avax.network' for test network)", "https://testapi.avax.network")
    .add_network_option();
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
  const uri = URI(options.node);
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
        console.log(balance.toString());
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
      console.log(result.toString(10, 0));
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
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      let result = await get_first_unused_address(ava, chain_objects, root_key, true);
      console.log(result.non_change);
    });
});

/* Adapted from avm/tx.ts for class UnsignedTx */
async function sign_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, ledger) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    const result = await ledger.signTransaction(prefix, suffixes, buff);
    return result.signatures;
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, ledger) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, hash, addr_to_path, ledger.signHash);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

async function sign_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, ledger) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    const result = await ledger.signTransaction(prefix, suffixes, buff);
    return result.signatures;
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, ledger) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, hash, addr_to_path, ledger.signHash);
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}


/* Adapted from avm/tx.ts for class BaseTx */
async function sign_BaseTx(ava, chain_objects, inputs, txbuff, addr_to_path, ledgerSign) {
  let path_suffixes = new Set();
  for (let i = 0; i < inputs.length; i++) {
    const sigidxs = inputs[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      path_suffixes.add(addr_to_path[pkh_to_some_address(ava, chain_objects.alias, sigidxs[j].getSource())]);
    }
  }

  const path_suffix_to_sig_map = await sign_with_ledger(ledgerSign, txbuff, path_suffixes);

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

async function sign_with_ledger(ledgerSign, txbuff, path_suffixes) {
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
    const toAddress = options.to;
    const chain_objects = make_chain_objects(ava, toAddress.split("-")[0]);
    if (chain_objects.alias !== AvaJS.utils.XChainAlias)
      log_error_and_exit("Transfers are only possible on the " + AvaJS.utils.XChainAlias + " chain. If you are looking to transfer between chains, see `export`.")

    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, chain_objects, root_key);

      const amount = parse_amount(options.amount);
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
      const signedTx = await sign_UnsignedTx(ava, chain_objects, unsignedTx, prepared.addr_to_path, ledger);
      console.error("Issuing TX...");
      const txid = await chain_objects.api.issueTx(signedTx);
      console.log(txid);
    });
});

program
  .command("export")
  .description("Export AVAX to another chain")
  .requiredOption("--amount <amount>", "Amount to transfer, specified in nanoAVAX")
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
    switch (source_chain_alias) {
      case AvaJS.utils.PChainAlias:
        signing_function = signHash_UnsignedTx;
        break;
      case AvaJS.utils.XChainAlias:
        signing_function = sign_UnsignedTx;
        break;
    }
    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, source_chain_objects, root_key);

      const amount = parse_amount(options.amount);
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
      const signedTx = await signing_function(ava, source_chain_objects, unsignedExportTx, prepared.addr_to_path, ledger);
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
  .add_chain_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const destination_chain_alias = toAddress.split("-")[0];
    const destination_chain_objects = make_chain_objects(ava, destination_chain_alias);
    switch (destination_chain_alias) {
      case AvaJS.utils.XChainAlias:
        source_chain_id = AvaJS.utils.PlatformChainID;
        signing_function = sign_UnsignedTxImport;
        break;
      case AvaJS.utils.PChainAlias:
        source_chain_id = ava.XChain().getBlockchainID();
        signing_function = signHash_UnsignedTxImport;
        break;
    }
    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, destination_chain_objects, root_key);

      const amount = parse_amount(options.amount);
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
      const signedTx = await signing_function(ava, destination_chain_objects, unsignedImportTx, prepared.addr_to_path, ledger);
      console.error("Issuing TX...");
      const txid = await destination_chain_objects.api.issueTx(signedTx);
      console.log(txid);
    });
});

function unix_now() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 10);
  return Math.floor(date / 1000);
}

function unix_one_year() {
  const date = new Date();
  date.setYear(date.getFullYear() + 1);
  return Math.floor(date / 1000);
}

program
  .command("validate")
  .description("Add a validator")
  .requiredOption("--amount <amount>", "Amount to stake, specified in nanoAVAX")
  .option("--start <unixtime>", "Start time", unix_now())
  .option("--end <unixtime>", "End time", unix_one_year())
  .option("--reward-address <address>", "P-Chain address the rewards should be delivered to")
  .requiredOption("--delegation-fee <fee>", "Delegation fee, percent")
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options)
    const chain_objects = make_chain_objects(ava, AvaJS.utils.PChainAlias);
    // TODO parse these properly
    const startTime = new BN(options.start);
    const endTime = new BN(options.end);
    return await withLedger(options, async ledger => {
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);

      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, chain_objects, root_key);

      const stakeAmount = parse_amount(options.amount);
      // TODO parse this properly
      const delegationFee = Number.parseFloat(options.delegationFee);
      // These are the staking addresses
      const fromAddresses = prepared.addresses;

      console.error("Getting new change address...");
      // TODO don't loop again. get this from prepare_for_transfer for the change addresses
      const changeAddress = (await get_first_unused_address(ava, chain_objects, root_key)).change;
      // Rewards go to the staking addresses unless otherwise specified
      const rewardAddresses = options.rewardAddress === undefined ? fromAddresses : [options.rewardAddress];
      const nodeID = await ava.Info().getNodeID();

      console.error("Building TX...");

      const unsignedAddValidatorTx = await chain_objects.api.buildAddValidatorTx(
        prepared.utxoset,
        fromAddresses, // Return the staked tokens to the staking addresses
        fromAddresses,
        [changeAddress],
        nodeID,
        startTime,
        endTime,
        stakeAmount,
        rewardAddresses,
        delegationFee,
      );
      console.error("Unsigned Add Validator TX:");
      console.error(unsignedAddValidatorTx.toBuffer().toString("hex"));
      const signedTx = await signHash_UnsignedTx(ava, chain_objects, unsignedAddValidatorTx, prepared.addr_to_path, ledger);
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
