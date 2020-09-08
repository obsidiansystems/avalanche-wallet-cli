{ pkgs ? import ./nixpkgs.nix
, cli-app-avalanche
, gecko
, speculos
}:
let
  test-certs-dir = pkgs.copyPathToStore ../testnet/certs;

  createEnvScript = name: env:
    let setEnvVars = with pkgs.lib; concatStringsSep " && " (attrValues (mapAttrs (k: v: "${k}=${v}") env));
    in pkgs.writeScriptBin name "${setEnvVars}";

  mkTestScript = appElf:
    let
      testScriptEnv = {
        GECKO = "${gecko}/bin/avalanche";
        PLUGINS = "${gecko}/plugins";
        CERTS = "${test-certs-dir}";
        SPECULOS = "${speculos}/bin/speculos";
        CLI = "${cli-app-avalanche}/bin/avalanche-ledger-cli";
        LEDGER_APP = "${appElf}";
        bats = "${pkgs.bats}/bin/bats";
      };
      test-env-name = "test-env";
      test-env = createEnvScript test-env-name testScriptEnv;
    in pkgs.writeScriptBin "test-script" ''./tests.sh ${test-env}/bin/${test-env-name}'';

in mkTestScript
