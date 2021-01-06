{ pkgs
, cli-app-avalanche
, gecko
, speculos
, appElf ? null
}:
let
  test-certs-dir = pkgs.copyPathToStore ../testnet/certs;

  testScriptText = ''
    #!${pkgs.bash}/bin/bash
    export PATH=${pkgs.jq}/bin:${pkgs.curl}/bin:${pkgs.ncurses}/bin:$PATH
    export GECKO='${gecko}/bin/avalanche'
    export PLUGINS='${gecko}/plugins'
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
