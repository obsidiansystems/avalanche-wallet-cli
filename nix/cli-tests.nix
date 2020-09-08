{ cli-app-avalanche, gecko, pkgs ? import ./nix/nixpkgs.nix }:
let
  cli = cli-app-avalanche;
  speculos = pkgs.callPackage ./nix/dep/speculos { };
  test-certs-dir = pkgs.copyPathToStore ./testnet/certs;

  createEnvScript = name: env:
    let setEnvVars = with pkgs.lib; concatStringsSep " && " (attrValues (mapAttrs (k: v: "${k}=${v}") env));
    in pkgs.writeScriptBin name "${setEnvVars}";

  mkTestScript = appElf:
    let
      testScriptEnv = {
        "GECKO"=''"${gecko}/bin/avalanche"'';
        "PLUGINS"=''"${gecko}/plugins"'';
        "CERTS"=''"${test-certs-dir}"'';
        "SPECULOS"=''"${speculos.speculos}/bin/speculos"'';
        "CLI"=''"${cli}/bin/avalanche-ledger-cli"'';
        "LEDGER_APP"=''"${appElf}"'';
        "bats"=''"${pkgs.bats}/bin/bats"'';
      };
      test-env-name = "test-env";
      test-env = createEnvScript test-env-name testScriptEnv;
    in pkgs.writeScriptBin "test-script" ''./tests.sh ${test-env}/bin/${test-env-name}'';

in mkTestScript
