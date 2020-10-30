{ pkgs ? import ./nixpkgs.nix }:
let
  # This function allows us to patch the src with 'go mod tidy' before building
  runGoModTidy = go: go.stdenv.mkDerivation {
    name = "setup";
    src = pkgs.fetchThunk ./dep/coreth;
    nativeBuildInputs = with pkgs; [ go git cacert ];
    inherit (go) GOOS GOARCH;
    GO111MODULE = "on";

    impureEnvVars = pkgs.lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND" "SOCKS_SERVER"
    ];

    configurePhase = ''
      runHook preConfigure
      export GOCACHE=$TMPDIR/go-cache
      export GOPATH="$TMPDIR/go"
      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild
      go mod tidy
      mkdir -p $out
      mkdir -p $out/patched
      cp -r ./** $out/patched
    '';
    dontInstall = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "1h74qdyxy0j3sz1ic7qfv0y638bxvlgri6gfbim5kgjyzg06zkqn";

  };
in pkgs.buildGoModule {
    name = "coreth";
    src = "${runGoModTidy pkgs.buildPackages.go_1_14}/patched";
    modSha256 = "049m3gc7am8cd3rj04q03m3cv6lvw3rafy4v3yhdixi2ihrid1w2";
    runVend = true;
    doCheck = false;
    buildPhase = ''
      mkdir -p $out
      mkdir -p $out/bin
      go build -o $out/bin/evm $src/plugin/*.go
    '';
    dontInstall = true;
}
