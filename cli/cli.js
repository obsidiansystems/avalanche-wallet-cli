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
const HwAppAvalanche = require("@obsidiansystems/hw-app-avalanche").default;
const HwAppEth = require("@ledgerhq/hw-app-eth").default;
const EthereumjsCommon = require('@ethereumjs/common').default;
const EthereumjsTx = require("@ethereumjs/tx").Transaction;
const {bnToRlp, rlp} = require("ethereumjs-util");
const Web3 = require('web3');
const keccak256 = require('keccak256');
const secp256k1 = require('secp256k1');

const {expect} = require("chai");

const axios = require("axios");

axios.interceptors.response.use(
  function (response) {
    if (process.env.RPCLOG === "always" || (response.data.error !== undefined && process.env.RPCLOG !== "never")) {
      console.error("axios response intercept: " + JSON.stringify( {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      config: response.config}
      ));
    }
    return response;
  }, function (error) {
    return Promise.reject(error);
  });

const BinTools = AvaJS.BinTools.getInstance();
const bech32 = require('bech32');

const AVA_BIP32_PREFIX = "m/44'/9000'/0'" // Restricted to 0' for now
const ETH_BIP32_PREFIX = "m/44'/60'/0'" // Restricted to 0' for now
const INDEX_RANGE = 20; // a gap of at least 20 indexes is needed to claim an index unused
const SCAN_SIZE = 70; // the total number of utxos to look at initially to calculate last index

const nativeAssetCallAddr = "0x0100000000000000000000000000000000000002"

const ASSET_CALL_GAS_LIMIT = 1e5

// https://github.com/ava-labs/avalanche-docs/blob/4be62d012368fe77caec6afe9d963ed4cc1e6501/learn/platform-overview/transaction-fees.md
const C_CHAIN_GAS_LIMIT = 1e9;
const C_CHAIN_BASE_TX_FEE = 21000;
const C_CHAIN_GAS_PRICE = 4.7e-7 * 1e9 * 1e9 // 1 AVAX = 1e9 nAVAX, 1nAVAX ~ 1 Gwei, 1 Gwei = 1e9 Wei;

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
    .option("--device <device>", "Device to use for signing")
    .option("--wallet <wallet-id>", "Use a device with this wallet ID")
    .option("--speculos <apdu-port>", "(for testing) Use the Ledger Speculos transport instead of connecting via USB and connect over the given port to communicate APDUs; overrides --device", parseInt)
    .option("--speculos-button-port <port>", "(requires --speculos) Use the given port for automatically interacting with speculos buttons", parseInt)
    .option("--speculos-automation-port <port>", "(requires --speculos) Use the given port for automatically interacting with speculos screens", parseInt)
  ;
}

commander.Command.prototype.add_network_option = function() {
  return this.requiredOption("--network <network>", "Network name [avax, fuji, local]", "avax");
}

// Convenience function to add the --node option
commander.Command.prototype.add_node_option = function() {
  return this
    .requiredOption("-n, --node <uri>", "Node to use (avax mainnet defaults to 'https://api.avax.network', fuji defaults to 'https://api.avax-test.network', local defaults to 'http://localhost:9650')", "network-default-node")
    .add_network_option();
}

commander.Command.prototype.add_assetID_option = function() {
  return this.option("--assetID <uint256>", (x) => parseInt(x, 10));
}

const network_default_node = {
  "avax" : "https://api.avax.network",
  "fuji" : "https://api.avax-test.network",
  "local" : "http://localhost:9650",
};

function get_network_node(options) {
  return URI(options.node === "network-default-node" ? network_default_node[options.network] : options.node);
}

commander.Command.prototype.add_chain_option = function() {
  return this
    .option("--chain <chain>"
            , "Chain [" + AvaJS.utils.XChainAlias + ", " + AvaJS.utils.PChainAlias + ", " + AvaJS.utils.CChainAlias + "]"
            , AvaJS.utils.XChainAlias);
}

function get_network_id_from_hrp(hrp) {
  const network_id = AvaJS.utils.HRPToNetworkID[hrp];
  if (network_id === undefined) throw "Network " + hrp + " is not recognized";
  return network_id;
}

function ava_js_from_options(options) {
  const uri = get_network_node(options);
  const network_id = get_network_id_from_hrp(options.network);
  return new AvaJS.Avalanche(uri.hostname(), uri.port(), uri.protocol(), network_id);
}

function make_chain_objects(ava, alias) {
  switch (alias) {
    case AvaJS.utils.XChainAlias:
      return ({ "vm": AvaJS.avm, "api": ava.XChain(), "alias" : AvaJS.utils.XChainAlias });
    case AvaJS.utils.PChainAlias:
      return ({ "vm": AvaJS.platformvm, "api": ava.PChain(), "alias" : AvaJS.utils.PChainAlias });
    case AvaJS.utils.CChainAlias:
      return ({ "vm": AvaJS.evm, "api": ava.CChain(), "alias" : AvaJS.utils.CChainAlias });
    default:
      log_error_and_exit("Unsupported chain alias: " + alias);
  }
}

// avalanchego produces addresses with the following properties
// - for platform addresses, prefix is P-, a bech32 encoded payload (with hrp of "local" or whatever for the chain id)
// - for exchange addresse, prefix is X-, and bech32 as above
// - for contract addresses, a prefix of 0x with hex encoded payload, with case mixed checksum.
// we need to make sure we understand all of the above cases, since those will
// most likely be used by regular users.  This is also the format used in
// existing web based block explorers
// we'll also accept a handful of other cases; C-[bech32] for contract addresses, and bare [bech32] for exchange addresses (with no prefix)
// this function returns an object with the right api to operate on the given address (as in make_chain_objects),
function parseAddress (addrString) {
  const dash = addrString.indexOf("-");
  var chainAlias, addrRest, addrHex, addrBytes, hrp;
  if (dash == -1) {
    addrRest = addrString;

    // we now proceed to guess the network id:
    // if it looks like hex, guess C chain, otherwise parse as bech32 and look at the HRP
    if (addrString.match(/^0x[0-9a-fA-F]{2}/) !== null) {
      chainAlias = "C";
      addrHex = addrRest;
      addrBytes = Buffer.from(addrHex.slice(2), "hex");
    } else {
      throw ("invalid address: " + addrString);
    }
  } else {
    chainAlias = addrString.slice(0, dash);
    addrRest = addrString.slice(dash + 1);
    if (addrRest.match(/^0x[0-9a-fA-F]{2}/) !== null) {
      addrHex = addrRest;
      addrBytes = Buffer.from(addrHex.slice(2), "hex");
    } else {
      const b = bech32.decode(addrRest)
      addrBytes = Buffer.from(bech32.fromWords(b.words));
      hrp = b.prefix;
      addrHex = "0x" + addrBytes.toString("hex");
    }
  }


  return function (ava) {
    const chain_objects = make_chain_objects(ava, chainAlias);
    chain_objects.asEnteredByUser = addrString;
    chain_objects.normalised = chainAlias + "-" + addrRest;
    chain_objects.addrHex = addrHex;
    chain_objects.addrBytes = addrBytes;
    chain_objects.hrp = hrp !== undefined ? hrp : ava.getHRP();

    chain_objects.addrBech32 = chainAlias + "-" + bech32.encode(chain_objects.hrp, bech32.toWords(addrBytes));

    return chain_objects;
  };
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
        const ledger = new HwAppAvalanche(transport);
        const device_wallet_id = await ledger.getWalletId().catch(() => console.error("[Skipped: Couldn't get wallet ID]"));
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
    return await f(new HwAppAvalanche(transport), new HwAppEth(transport));
  });
}

function requestLedgerAccept() {
  console.error("Please accept the prompt on your Ledger device.");
}

const program = new commander.Command();

program.version("0.2.0");

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
  .description("Get the address of a derivation path. <path> should be 'change/address_index'")
  .add_device_option()
  .add_node_option()
  .add_chain_option()
  .action(async (path, options) => {
    get_network_id_from_hrp(options.network); // validate the network
    const ava = ava_js_from_options(options);
    const chain_objects = make_chain_objects(ava, options.chain);
    return await withLedger(options, async (avalanche, evm) => {
      // BIP32: m / purpose' / coin_type' / account' / change / address_index
      path = AVA_BIP32_PREFIX + "/" + path;
      console.error("Getting public key for path", path);
      requestLedgerAccept();

      if (automationEnabled(options)) flowAccept(avalanche.transport);

      if (chain_objects.alias == AvaJS.utils.CChainAlias) {
        const pk = await evm.getAddress(path, true, true);
        console.log("C-0x" + ledgerAddressWorkaround(pk));
      }
      else {
        const pubk_hash = await avalanche.getWalletAddress(path, options.network);
        console.log(pkh_to_some_address(ava, chain_objects.alias, pubk_hash));
      }
    });
});

program
  .command("get-extended-public-key [path]")
  .description("Get the extended public key of a derivation path. <path> should be 'change/address_index'")
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
  const extended_public_key = await ledger.getWalletExtendedPublicKey(deriv_path);
  const hdw = new HDKey();
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
  var address_to_path = {};

  await traverse_used_keys(ava, chain_objects, hdkey, batch => {
    utxoset = utxoset.union(batch.utxoset);
    addresses = addresses.concat(batch.non_change.addresses);
    pkhs = pkhs.concat(batch.non_change.pkhs);
    change_addresses = change_addresses.concat(batch.change.addresses);
    change_pkhs = change_pkhs.concat(batch.change.pkhs);
    Object.assign(address_to_path, batch.address_to_path);
  });

  // Go backwards through the generated addresses to find the last unused address
  var last_unused = null;
  for (var i = addresses.length - 1; i >= 0; i--) {
    const pkh = pkhs[i].toString('hex');
    const utxoids = utxoset.addressUTXOs[pkh];
    const change_pkh = change_pkhs[i].toString('hex');
    const change_utxoids = utxoset.addressUTXOs[change_pkh];
    if (utxoids === undefined && change_utxoids === undefined) {
      last_unused = {
        non_change: addresses[i],
        non_change_path: address_to_path[addresses[i]],
        change: change_addresses[i],
        change_path: address_to_path[change_addresses[i]],
      };
    } else {
      break;
    }
  }

  return last_unused;
}

function hdkey_to_pkh(hdkey) {
  return (new AvaJS.common.SECP256k1KeyPair()).addressFromPublicKey(hdkey.publicKey);
}
function eth_hdkey_to_pkh(hdkey) {
  return eth_key_to_address(Buffer.from(secp256k1.publicKeyConvert(hdkey.publicKey, false)).slice(1));
}
function eth_key_to_address(pk) {
  return keccak256(pk).slice(-20);
}
// TODO: fix/bump ledger
function ledgerAddressWorkaround(pk) {
    let buf = Buffer.from(pk.publicKey, 'hex').slice(1);
    return eth_key_to_address(buf).toString('hex');
}

function pkh_to_some_address(ava, alias, pkh) {
  switch (alias) {
    case "C":
      // return alias + "-" + "0x" + pkh.slice(0,20).toString("hex");
      return alias + "-" + bech32.encode(ava.hrp, bech32.toWords(pkh.slice(0,20)));
    default:
      return alias + "-" + bech32.encode(ava.hrp, bech32.toWords(pkh));
  }
}

// Traverse children of a hdkey with the given function. Stops when at least
// INDEX_RANGE addresses are "unused" (right now, this means they have no UTXOs)
// TODO check TX history too to determine unused status
async function traverse_used_keys(ava, chain_objects, hdkey, batched_function) {
  // getUTXOs is slow, so we generate INDEX_RANGE addresses at a time and batch them
  // Only when INDEX_RANGE addresses have no UTXOs do we assume we are done
  var index = 0;
  var all_unused = false;
  // const hashAddress = chain_objects.alias === "C" ? eth_hdkey_to_pkh : hdkey_to_pkh;
  const hashAddress = hdkey_to_pkh;
  while (!all_unused || index < SCAN_SIZE) {
    const batch = {
      address_to_path: {}, // A dictionary from AVAX address to path (change/address)
      non_change: { addresses: [], pkhs: []},
      change: { addresses: [], pkhs: []},
    };
    for (var i = 0; i < INDEX_RANGE; i++) {
      const child = hdkey.deriveChild(0).deriveChild(index + i);
      const change_child = hdkey.deriveChild(1).deriveChild(index + i);
      const pkh = hashAddress(child);
      const change_pkh = hashAddress(change_child);
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
    batch.utxoset = await (await chain_objects.api.getUTXOs(batch.non_change.addresses.concat(batch.change.addresses), chain_objects.alias)).utxos;

    // Run the batch function
    batched_function(batch);

    index = index + INDEX_RANGE;
    all_unused = batch.utxoset.getAllUTXOs().length === 0;
  }
}

// Given a hdkey (at the account level), sum the UTXO balances
// under that key.
async function sum_child_balances(ava, chain_objects, hdkey) {
  var balance = new BN(0);

  await traverse_used_keys(ava, chain_objects, hdkey, async batch => {
    // Total the balance for all PKHs
    for (const [pkhIgnored, utxoids] of Object.entries(batch.utxoset.addressUTXOs)) {
      var bal = new BN(0);
      for (const utxoid of Object.keys(utxoids)) {
        bal = bal.add(batch.utxoset.utxos[utxoid].getOutput().getAmount());
      }
      balance = balance.add(bal);
    }
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
  .add_assetID_option()
  .action(async (address, options) => {
    const ava = ava_js_from_options(options);
    const getBalanceCChain = async (chain_objects, addrHex) => {
      const rpc = get_network_node(options).path('/ext/bc/C/rpc');
      const web3 = new Web3(rpc.toString());
      if(options.assetID == undefined) {
          const result = await web3.eth.getBalance(addrHex);
          console.log(result + " WEI");
      }
      else {
          const response = await chain_objects.api.callMethod (
              "eth_getAssetBalance",
              [chain_objects.addrHex, "latest", options.assetID],
              "ext/bc/C/rpc");
          const balance = parseInt(response.data.result, 16);
          console.log(balance);
      }
    };

    if (address === undefined) {
      const chain_objects = make_chain_objects(ava, options.chain);
      await withLedger(options, async (avalancheLedger, evmLedger) => {

        switch(chain_objects.alias) {
          case "C": {
            const path = AVA_BIP32_PREFIX + "/" + "0/0";
            console.error("Getting public key for path", path);
            requestLedgerAccept();
            if (automationEnabled(options)) flowAccept(avalancheLedger.transport);
            const pk = await evmLedger.getAddress(path);
            const defaultCChainAddress = "0x" + ledgerAddressWorkaround(pk);
            await getBalanceCChain(chain_objects, defaultCChainAddress);
            break;
          }
          default: {
            if (automationEnabled(options)) flowAccept(avalancheLedger.transport);
            const root_key = await get_extended_public_key(avalancheLedger, AVA_BIP32_PREFIX);
            const balance = await sum_child_balances(ava, chain_objects, root_key, options.listAddresses);
            console.log(balance.toString() + " nAVAX");
          }
        }
      });
    } else {
      const chain_objects = parseAddress(address)(ava);

      switch(chain_objects.alias) {
        case "C": {
          getBalanceCChain(chain_objects, chain_objects.addrHex);
          // const rpc = get_network_node(options).path('/ext/bc/C/rpc');
          // const web3 = new Web3(rpc.toString());
          // if(options.assetID == undefined) {
          //     const result = await web3.eth.getBalance(chain_objects.addrHex);
          //     console.log(result + " WEI");
          // }
          // else {
          //     const response = await chain_objects.api.callMethod (
          //         "eth_getAssetBalance",
          //         [chain_objects.addrHex, "latest", options.assetID],
          //         "ext/bc/C/rpc");
          //     const balance = parseInt(response.data.result, 16);
          //     console.log(balance);
          // }
          break;
        }
        default: {
          const result
            = (await chain_objects.api.getBalance(address,
                BinTools.cb58Encode(await chain_objects.api.getAVAXAssetID())
                )).balance;

          console.log(result.toString(10, 0) + " nAVAX");
          break;
        }
      }
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
async function sign_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, changeAddress, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options))
      await flowMultiPrompt(ledger.transport);
    let changePath = null;
    if (changeAddress != null)
      changePath = BipPath.fromString(AVA_BIP32_PREFIX + "/" + addr_to_path[changeAddress]);
    const result = await ledger.signTransaction(prefix, suffixes, buff, changePath);
    return result.signatures;
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTx(ava, chain_objects, unsignedTx, addr_to_path, changeAddress, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.ins, hash, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options)) flowAccept(ledger.transport);
    const result = await ledger.signHash(prefix, suffixes, buff);
    return result
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

async function sign_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, changeAddress, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, txbuff, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options))
      await flowMultiPrompt(ledger.transport);
    let changePath = null;
    if (changeAddress != null)
      changePath = BipPath.fromString(AVA_BIP32_PREFIX + "/" + addr_to_path[changeAddress]);
    const result = await ledger.signTransaction(prefix, suffixes, buff, changePath);
    return result.signatures;
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}

/* An unsafe version of the above function, just signs a hash */
async function signHash_UnsignedTxImport(ava, chain_objects, unsignedTx, addr_to_path, changeAddress, ledger, options) {
  const txbuff = unsignedTx.toBuffer();
  const baseTx = unsignedTx.transaction;
  const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
  const sigs = await sign_BaseTx(ava, chain_objects, baseTx.importIns, hash, addr_to_path, async (prefix, suffixes, buff) => {
    if (automationEnabled(options)) flowAccept(ledger.transport);
    const result = await ledger.signHash(prefix, suffixes, buff);
    return result
  });
  return new chain_objects.vm.Tx(unsignedTx, sigs);
}


/* Adapted from avm/tx.ts for class BaseTx */
async function sign_BaseTx(ava, chain_objects, inputs, txbuff, addr_to_path, ledgerSign) {

  let path_suffixes = new Set();
  for (let i = 0; i < inputs.length; i++) {
    const sigidxs = inputs[i].getInput().getSigIdxs();
    for (let j = 0; j < sigidxs.length; j++) {
      const addr = pkh_to_some_address(ava, chain_objects.alias, sigidxs[j].getSource());
      if (!Object.prototype.hasOwnProperty.call(addr_to_path, addr)) {
        console.error("Can't find path for", addr)
      }
      path_suffixes.add(addr_to_path[addr]);
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
  console.error("Signing transaction", txbuff.toString('hex').toUpperCase(), `(${txbuff.length} bytes)`, "with paths", path_suffixes_arr);
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
    case "AVAX":
    case "": {
      const mkExp = n => (new BN(10)).pow(new BN(n));
      const i = (new BN(integerPart)).mul(mkExp(9));
      const exponent = 9 - fractionalPart.length;
      if (exponent < 0) return false; // Specified more precision than AVAX can hold
      const f = new BN(fractionalPart).mul(mkExp(exponent));
      return i.add(f);
    }
    default:
      return false;
  }
}

function parseVersion(str) {
  const parts = str.split(".");
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

function compareVersions(a, b) {
    switch (Math.sign(a.major - b.major)) {
        case -1: return -1;
        case 1: return 1;
        default: switch (Math.sign(a.minor - b.minor)) {
            case -1: return -1;
            case 1: return 1;
            default: return Math.sign(a.patch - b.patch);
        }
    }
}

function maxVersion(a, b) {
    return compareVersions(a, b) >= 0 ? a : b;
}

async function getParsedVersion(ledger) {
  const appDetails = await ledger.getAppConfiguration();
  return parseVersion(appDetails.version);
}

async function makeLedgerSignedTxEVM(ledgerEvm, options, web3, partialTxParams) {
  const path = AVA_BIP32_PREFIX + "/0/0"; // TODO: Use ETH?
  const pk = await ledgerEvm.getAddress(path, true, true);
  const address = ledgerAddressWorkaround(pk);
  const nonce = "0x" + (await web3.eth.getTransactionCount(address)).toString(16);
  const unsignedTxParams = {...partialTxParams, nonce};

  const chainId = await web3.eth.getChainId();
  const networkId = await web3.eth.net.getId();
  const chainParams = { common: EthereumjsCommon.forCustomChain('mainnet', { networkId, chainId }, 'istanbul')};

  const unsignedTx = EthereumjsTx.fromTxData({...unsignedTxParams}, chainParams);
  //TODO: fix upstream serialize for EIP155
  const rawUnsignedTx = rlp.encode([
      bnToRlp(unsignedTx.nonce),
      bnToRlp(unsignedTx.gasPrice),
      bnToRlp(unsignedTx.gasLimit),
      unsignedTx.to !== undefined ? unsignedTx.to.buf : Buffer.from([]),
      bnToRlp(unsignedTx.value),
      unsignedTx.data,
      bnToRlp(new BN(chainId)),
      Buffer.from([]),
      Buffer.from([]),
  ]);

  if (automationEnabled(options)) flowAccept(ledgerEvm.transport);
  const signature = await ledgerEvm.signTransaction(path, rawUnsignedTx);
  const signatureBN = {
      v: new BN(signature.v, 16),
      r: new BN(signature.r, 16),
      s: new BN(signature.s, 16),
  };
  const signedTx = EthereumjsTx.fromTxData({...unsignedTxParams,...signatureBN}, chainParams);
  return signedTx.serialize().toString('hex');
}

async function assetCall(ledgerEvm, options, web3, addr, assetID, amount, shouldDeposit) {
  const assetIDABI = web3.eth.abi.encodeParameter('uint256', BinTools.cb58Decode(assetID));
  const amountABI = web3.eth.abi.encodeParameter('uint256', amount);
  const sig = web3.eth.abi.encodeFunctionSignature("deposit()").slice(2);
  const data = addr + assetIDABI.slice(2) + amountABI.slice(2) + (shouldDeposit ? sig : "");

  const toHex = n => '0x' + n.toString(16);
  const txParams = {
    to: nativeAssetCallAddr,
    value: toHex(0),
    data: "0x" + data,
    gasLimit: toHex(ASSET_CALL_GAS_LIMIT),
    gasPrice: toHex(C_CHAIN_GAS_PRICE)
  };
  if (automationEnabled(options)) flowAccept(ledgerEvm.transport);
  const signedTxHex = await makeLedgerSignedTxEVM(ledgerEvm, options, web3, txParams);
  return await web3.eth.sendSignedTransaction('0x' + signedTxHex);
}

program
  .command("deposit")
  .description("Deposit an ANT into an ARC-20")
  .requiredOption("--amount <amount>", "Amount to transfer, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .requiredOption("--to <account>", "ARC-20 address")
  .add_node_option()
  .add_device_option()
  .add_assetID_option()
  .action(async options => await withLedger(options, async (avalanche, evm) => {
      const rpc = get_network_node(options).path('/ext/bc/C/rpc');
      const web3 = new Web3(rpc.toString());
      const ava = ava_js_from_options(options);
      const chain_objects = parseAddress(options.to)(ava);
      const amount = parseAmountWithError(options.amount);

      if (chain_objects.alias != AvaJS.utils.CChainAlias)
          log_error_and_exit("Can only deposit on C-chain addresses")

      await assetCall(evm, options, web3, chain_objects.addrHex.slice(2), options.assetID, amount, true);
  }))

program
  .command("transfer")
  .description("Transfer assets between addresses")
  .requiredOption("--amount <amount>", "Amount to transfer, e.g. '1.5' or '100000n'. If units are missing, whole units are assumed.")
  .requiredOption("--to <account>", "Receiving address")
  .add_node_option()
  .add_device_option()
  .add_assetID_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const chain_objects = parseAddress(options.to)(ava);
    const supportedChains = [AvaJS.utils.CChainAlias, AvaJS.utils.XChainAlias];
    if (-1 == supportedChains.indexOf(chain_objects.alias))
      log_error_and_exit("Transfers are only possible on chains "
                         + supportedChains.join(" & ")
                         + ". If you are looking to transfer between chains, see `export`.")
    const amount = parseAmountWithError(options.amount);

    return await withLedger(options, async (avalanche, evm) => {
      const rpc = get_network_node(options).path('/ext/bc/C/rpc');
      const web3 = new Web3(rpc.toString());
      const toHex = n => '0x' + n.toString(16);

      if (chain_objects.alias == AvaJS.utils.CChainAlias) {
          if(options.assetID == undefined) {
            const txParams = {
              to: chain_objects.addrHex,
              value: toHex(amount),
              gasLimit: toHex(C_CHAIN_BASE_TX_FEE),
              gasPrice: toHex(C_CHAIN_GAS_PRICE)
            };
            if (automationEnabled(options)) flowAccept(avalanche.transport);
            const signedTxHex = await makeLedgerSignedTxEVM(evm, options, web3, txParams);
            await web3.eth.sendSignedTransaction('0x' + signedTxHex);
          }
          else
              await assetCall(evm, options, web3, chain_objects.addrHex.slice(2), options.assetID, amount, false);
      } else {
          if (automationEnabled(options)) flowAccept(avalanche.transport);
          const version = await getParsedVersion(avalanche);
          const signFunction = (version.major === 0 && version.minor < 3) ? signHash_UnsignedTx : sign_UnsignedTx

          const root_key = await get_extended_public_key(avalanche, AVA_BIP32_PREFIX);
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
          const signedTx = await signFunction(ava, chain_objects, unsignedTx, prepared.addr_to_path, changeAddress, avalanche, options);
          console.error("Issuing TX...");
          const txid = await chain_objects.api.issueTx(signedTx);
          console.log(txid);
      }
    });
});

// the minimum version that sign_UnsignedTx may be used for the given network/operation
const minVersionForUnhashedSign =
    { "X": {
        "export": parseVersion("0.3.0"),
        "import": parseVersion("0.3.0")
    }
    , "P": {
        "export": parseVersion("0.3.0"),
        "import": parseVersion("0.3.0")
    }
    , "C": {
        "export": parseVersion("0.4.0"),
        "import": parseVersion("0.4.0")
    }
    }


function getSupportsUnhashedSigningForVersion(version, ops) {
    var minRequiredVersion = parseVersion("0.0.0");

    for (var i = 0; i < ops.length; ++i) {
        const opVersion = minVersionForUnhashedSign[ops[i][0]][ops[i][1]];
        if (opVersion === undefined) {
            throw ("bad op:" + ops[i]);
        }
        minRequiredVersion = maxVersion(minRequiredVersion, opVersion);
    }
    // TODO: warn the user when they should update
    return ((compareVersions(minRequiredVersion, version) <= 0)) ;
}

program
  .command("export")
  .description("Export AVAX to another chain")
  .requiredOption("--amount <amount>", "Amount to transfer, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .requiredOption("--to <account>", "Recipient's address")
  .option("--path <account>", "Sender Path", "0/0")
  .add_chain_option()
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const destination_chain_objects = parseAddress(toAddress)(ava);
    const destination_chain_alias = destination_chain_objects.alias;
    const destination_chain_id = destination_chain_objects.api.getBlockchainID();

    if (destination_chain_alias == options.chain) {
      log_error_and_exit ("invalid --chain; source and destination must be different");
    }

    const source_chain_alias = options.chain;
    const source_chain_objects = make_chain_objects(ava, source_chain_alias);
    const amount = parseAmountWithError(options.amount);
    return await withLedger(options, async (ledger, ethApp) => {
      const version = await getParsedVersion(ledger);
      const signFunction = getSupportsUnhashedSigningForVersion(version, [[destination_chain_alias, "export"]]) ? sign_UnsignedTx : signHash_UnsignedTx;

      var txid
      if (source_chain_alias === AvaJS.utils.CChainAlias) {
        console.log("cchain export to", toAddress, destination_chain_objects.addrHex)

        if (automationEnabled(options)) flowAccept(ledger.transport);
        const path = options.path
        const fromPk = await ethApp.getAddress(AVA_BIP32_PREFIX + "/" + path);

        const fromAddressHex = ledgerAddressWorkaround(fromPk);
        const fromAddressBech = "C-" + bech32.encode(ava.getHRP(), bech32.toWords( hdkey_to_pkh({publicKey: Buffer.from(fromPk.publicKey, "hex")})));

        // TODO: get this from options.amount
        // const assetId = await destination_chain_objects.api.getAVAXAssetID()
        const assetDesc = await destination_chain_objects.api.getAssetDescription('AVAX');


        const rpc = get_network_node(options).path('/ext/bc/C/rpc');
        const web3 = new Web3(rpc.toString());
        const nonce = await web3.eth.getTransactionCount(fromAddressHex);
        const unsignedExportTx = await source_chain_objects.api.buildExportTx(
            amount,
            BinTools.cb58Encode(assetDesc.assetID),
            destination_chain_id,
            fromAddressHex,
            fromAddressBech,
            [toAddress],
            nonce
          );

        console.error("Unsigned Export TX:");
        console.error(unsignedExportTx.toBuffer().toString("hex"));


        // const changeAddress = "bogusChangeAddress"; // unused in this codepath probably.
        const addr_to_path = {}; // XXX
        addr_to_path[fromAddressBech] = options.path;

        const txbuff = unsignedExportTx.toBuffer();

        const hash = Buffer.from(createHash('sha256').update(txbuff).digest());
        const chain_objects = source_chain_objects;
        const inputs = unsignedExportTx.transaction.getInputs();

        let path_suffixes = new Set();
        for (let i = 0; i < inputs.length; i++) {
          const sigidxs = inputs[i].getSigIdxs();
          for (let j = 0; j < sigidxs.length; j++) {
            const addr = pkh_to_some_address(ava, chain_objects.alias, sigidxs[j].getSource());
            path_suffixes.add(addr_to_path[addr]);
          }
        }

        const path_suffix_to_sig_map =
          getSupportsUnhashedSigningForVersion(version, [[destination_chain_alias, "export"]])
          ? await sign_with_ledger(async (prefix, suffixes, buff) => {
              if (automationEnabled(options)) flowAccept(ledger.transport);
              const result = await ledger.signHash(prefix, suffixes, buff);
              return result
            }, hash, path_suffixes)
          : await sign_with_ledger(async (prefix, suffixes, buff) => {
              if (automationEnabled(options))
                await flowMultiPrompt(ledger.transport);
              let changePath = null;
              // if (changeAddress != null)
              //   changePath = BipPath.fromString(AVA_BIP32_PREFIX + "/" + addr_to_path[changeAddress]);
              const result = await ledger.signTransaction(prefix, suffixes, buff, changePath);
              return result.signatures;
            }, txbuff, path_suffixes)
          ;

        const sigs = [];
        for (let i = 0; i < inputs.length; i++) {
          const cred = chain_objects.vm.SelectCredentialClass(inputs[i].getCredentialID());
          const sigidxs = inputs[i].getSigIdxs();
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

        const signedTx = new source_chain_objects.vm.Tx(unsignedExportTx, sigs);
        console.error("Issuing TX...");

        txid = await source_chain_objects.api.issueTx(signedTx);

        // */

      } else {
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
        const signedTx = await signFunction(ava, source_chain_objects, unsignedExportTx, prepared.addr_to_path, changeAddress, ledger, options);
        console.error("Issuing TX...");
        txid = await source_chain_objects.api.issueTx(signedTx);

      }
      console.log(txid);
    });
});

program
  .command("import")
  .description("Import AVAX from a different chain")
  .requiredOption("--to <account>", "Recipient's address")
  .option("--dest <account>", "Recipient's change address")
  .add_chain_option()
  .add_node_option()
  .add_device_option()
  .action(async options => {
    const ava = ava_js_from_options(options);
    const toAddress = options.to;
    const destination_chain_objects = parseAddress(toAddress)(ava);
    // console.log(["toAddress:", destination_chain_objects]);
    const source_chain_objects = make_chain_objects(ava, options.chain);
    return await withLedger(options, async ledger => {
      const version = await getParsedVersion(ledger);
      const signFunction = getSupportsUnhashedSigningForVersion(version,
        [[destination_chain_objects.alias, "import"], [source_chain_objects.alias, "export"]]
      ) ? sign_UnsignedTxImport : signHash_UnsignedTxImport;

      const source_chain_id = source_chain_objects.api.getBlockchainID();

      if (automationEnabled(options)) flowAccept(ledger.transport);
      const root_key = await get_extended_public_key(ledger, AVA_BIP32_PREFIX);
      console.error("Discovering addresses...");
      const prepared = await prepare_for_transfer(ava, destination_chain_objects, root_key);

      const fromAddresses = [];
      const changeAddresses = [];
      console.error("Building TX...");

      const destAddress = options.dest !== undefined
        ? parseAddress(options.dest)(ava)
        : destination_chain_objects;

      const unsignedImportTx = await ((destination_chain_objects.alias == "C") // It seems like the evm api wants to have its arguments in a different order.
            ? destination_chain_objects.api.buildImportTx(
                prepared.utxoset,
                destAddress.addrHex,
                [destination_chain_objects.addrBech32],
                source_chain_id,
                fromAddresses,
              )
            : destination_chain_objects.api.buildImportTx(
                prepared.utxoset,
                [toAddress],
                source_chain_id,
                [toAddress],
                fromAddresses,
                changeAddresses
              ));
      console.error("Unsigned Import TX:");
      console.error(unsignedImportTx.toBuffer().toString("hex"));
      const signedTx = await signFunction(ava, destination_chain_objects, unsignedImportTx, prepared.addr_to_path, null, ledger, options);
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
    const mins = relative.mins === undefined ? 0 : relative.mins;
    const hours = relative.hours === undefined ? 0 : relative.hours;
    const days = relative.days === undefined ? 0 : relative.days;
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
      const signedTx = await signFunction(ava, chain_objects, unsignedAddValidatorTx, prepared.addr_to_path, changeAddress, ledger, options);
      console.error("Issuing TX...");
      const txid = await chain_objects.api.issueTx(signedTx);
      console.log(txid);
  });
});

program
  .command("delegate")
  .description("Delegate stake to a validator")
  .requiredOption("--amount <amount>", "Amount to stake, e.g. '1.5 AVAX' or '100000 nAVAX'. If units are missing, AVAX is assumed.")
  .option("--start-time <time>", "Start time, relative to now (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "10m")
  .option("--end-time <time>", "End time, relative to the start time (e.g. 10d5h30m), or absolute (2020-10-20 18:00)", "365d")
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
    const validators = await chain_objects.api.getCurrentValidators();
    const validator = validators.validators.find(v => v.nodeID === nodeId)
    if (validator !== undefined) {
      const validatorStartTime = new BN(validator.startTime);
      const validatorEndTime = new BN(validator.endTime);
      if (startTime.lt(validatorStartTime)) {
        const validatorDate = new Date(validatorStartTime.toNumber() * 1000);
        const delegatorDate = new Date(startTime.toNumber() * 1000);
        log_error_and_exit("Chosen delegation start time [" + delegatorDate.toString() + "] starts before the validator start time [" + validatorDate.toString() + "].");
      }
      if (endTime.gt(validatorEndTime)) {
        const validatorDate = new Date(validatorEndTime.toNumber() * 1000);
        const delegatorDate = new Date(endTime.toNumber() * 1000);
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
      const signedTx = await signFunction(ava, chain_objects, unsignedAddDelegatorTx, prepared.addr_to_path, changeAddress, ledger, options);
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
        var isFirst, isLast;
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
        for (const p in expectedPrompts) {
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
      var screen;
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
  // let subNum = speculos.handlerNum++;
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
      const promptVal=await sendPromise;
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
      var screen = { ...(header && {header}), body };
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
