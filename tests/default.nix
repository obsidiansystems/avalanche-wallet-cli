{ pkgs
, cli-app-avalanche
, avalanchego
, speculos
, appElf ? null
}:
let
  test-certs-dir = pkgs.copyPathToStore ../testnet/certs;

  testScriptText = ''
    #!${pkgs.bash}/bin/bash
    export PATH=${pkgs.jq}/bin:${pkgs.curl}/bin:$PATH
    export AVALANCHEGO='${avalanchego}/bin/avalanche'
    export PLUGINS='${avalanchego}/plugins'
    export CERTS='${test-certs-dir}'
    export SPECULOS='${speculos}/bin/speculos'
    export CLI='${cli-app-avalanche}/bin/avalanche-ledger-cli'
    export FAUCET='${cli-app-avalanche}/bin/avalanche-ledger-faucet'
    export bats='${pkgs.bats}/bin/bats'
    export TESTS_DIR='${./.}'
    export LEDGER_APP='${if appElf != null then appElf else ""}'
  '' + builtins.readFile ./tests.sh;
in rec {
  test-script = pkgs.writeScriptBin "test-script.sh" testScriptText;
  test-run = pkgs.runCommand "test-run" {} ''
    ${test-script}/bin/test-script.sh | tee $out
  '';
}
