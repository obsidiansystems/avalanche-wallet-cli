var assert = require('assert');
describe('Array', function () {
  describe('#indexOf()', function () {
    it('should return -1 when the value is not present', function () {
      assert.equal([1, 2, 3].indexOf(4), -1);
    });
  });
});
// const { recover } = require('bcrypto/lib/secp256k1');
// const BIPPath = require("bip32-path");
// const { expect } = require('chai').use(require('chai-bytes'));
// const { exec } = require('child_process');

// function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// function checkEnvVars() {
//   const varsToCheck = [ "CLI", "NODE_ARGS", "FAUCET"];
//   return varsToCheck.reduce((acc, envVar) => {
//     const val = process.env[envVar];
//     if(!val) 
//       process.exit(`Env Variable: ${envVar} not set`);
//     else
//       acc[envVar] = val;
//     return acc;
//   }, {});
// }

// const envVars = checkEnvVars();
// describe("Basic Tests", () => {
//   context('Basic Operations', function () {
//     // it('can fetch the version of the app', async function () {
//     //   const ui = await flowMultiPrompt(this.speculos, [
//     //     [{header:"Sign",body:"Transaction"}],
//     //     [{header:"Transfer",body:"4500000 to local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve"}],
//     //     [{header:"Fee",body:"1000000"}],
//     //     [{header:"Finalize",body:"Transaction"}],
//     //   ]);
//     //   const fakeAddr = 'X-local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve';
//     //   const transferCmd = `${process.env.CLI} transfer --amount 4500000 --to ${fakeAddr} --node ${NETWORK} --network local --speculos 9999`;
//     //   let stdout = null;
//     //   let stderr = null;
//     //   exec(transferCmd, (err, stdoutTmp, stderrTmp) => {
//     //     stdout = stdoutTmp; 
//     //     stderr = stderrTmp; 
//     //   });
//     //   await sleep(3000);
//     //   await ui.promptsPromise;
      
//     //   expect(cfg).to.have.property("name", "Avalanche");
//     // });
//     it('returns the expected wallet ID', async function () {
//       assert.equal(1, 2);
//       return;
//       const ui = await flowAccept(this.speculos);
//       const transferCmd = `${process.env.CLI} get-balance`
//       let stdout = null;
//       let stderr = null;
//       exec(transferCmd, (err, stdoutTmp, stderrTmp) => {
//         stdout = stdoutTmp; 
//         stderr = stderrTmp; 
//       });
//       await sleep(3000);
//       await ui.promptsPromise;
//       assert.equal(stdout, "0");
//     });
//   });
// });

