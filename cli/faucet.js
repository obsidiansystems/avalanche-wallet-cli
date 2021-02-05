#!/usr/bin/env node

const AvaJS = require("avalanche");
const bech32 = require('bech32');
const BN = require("bn.js");
const commander = require("commander");
const HDKey = require('hdkey');
const Ledger = require("@obsidiansystems/hw-app-avalanche").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const TransportSpeculos = require("@ledgerhq/hw-transport-node-speculos").default;
const URI = require("urijs");

const FAUCET_USERNAME = "faucet";
const FAUCET_PASSWORD = "good-cub-book";
const FAUCET_ADDRESS = "X-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u";
const AVAX_ASSET_ID = "AVAX";
const AVA_BIP32_PREFIX = "m/44'/9000'/0'" // Restricted to 0' for now

function automationEnabled(options) {
  return options.speculosAutomationPort && options.speculosButtonPort;
}

// For automated testing
function flowAccept(speculos, n) {
  console.error("Automatically accepting prompt.")
  return new Promise(r => {
    var isFirst, isLast;
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
  const extended_public_key = await ledger.getWalletExtendedPublicKey(deriv_path).catch(logErrorAndExit);
  const hdw = new HDKey();
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
  .option("--speculos <apdu-port>", "(for testing) use the Ledger Speculos transport instead of connecting via USB and connect over the given port to communicate APDUs; overrides --device", parseInt)
  .option("--speculos-button-port <port>", "(requires --speculos) use the given port for automatically interacting with speculos buttons", parseInt)
  .option("--speculos-automation-port <port>", "(requires --speculos) use the given port for automatically interacting with speculos screens", parseInt)
  .addNodeOption()
  .action(async (amount, options) => {
  let transport = null;
  if(options.speculos) {
    const speculosOpts = {
      apduPort: options.speculos,
      buttonPort: options.speculosButtonPort,
      automationPort: options.speculosAutomationPort,
    };
    transport = await TransportSpeculos.open(speculosOpts).catch(logErrorAndExit);
  }
  else {
    transport = await TransportNodeHid.open().catch(logErrorAndExit);
  }
  try {
    const ledger = new Ledger(transport);
    const ava = avaJsWithNode(options.node);
    const avm = ava.XChain();
    const amountBN = new BN(amount);
    if(automationEnabled(options)) flowAccept(ledger.transport);
    const non_change_key = await getExtendedPublicKey(ledger, AVA_BIP32_PREFIX + "/0");
    for (let i = 0; i < 5; i++) {
      const key = non_change_key.deriveChild(i);
      const to = hdkey_to_avax_address(key);
      const txHash = await avm.send(FAUCET_USERNAME, FAUCET_PASSWORD, AVAX_ASSET_ID, amountBN, to, [FAUCET_ADDRESS]).catch(logErrorAndExit);
      console.error("Funding", i, to, "TX", txHash.toString());
      // 1500 seems to be the minimum for working in CI
      await sleep(1500);
    }
  } finally {
    transport.close();
  }
});

async function main() {
  await program.parseAsync(process.argv);
}

main();
