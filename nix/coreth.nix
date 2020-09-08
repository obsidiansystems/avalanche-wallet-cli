{ pkgs ? import ./nixpkgs.nix }:
let
    fetchThunk = p:
      if builtins.pathExists (p + /git.json)
        then pkgs.fetchgit { inherit (builtins.fromJSON (builtins.readFile (p + /git.json))) url rev sha256; }
      else if builtins.pathExists (p + /github.json)
        then pkgs.fetchFromGitHub { inherit (builtins.fromJSON (builtins.readFile (p + /github.json))) owner repo rev sha256; }
      else p;

    # This function allows us to patch the src with 'go mod tidy' before building
    runGoModTidy = go: go.stdenv.mkDerivation {
      name = "setup";
    src = fetchThunk ./dep/coreth;
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
    outputHash = "sha256:00v1k2dafm9g05ains65j1igfkjfmgymv4nhm5fsjx19178dzj9c";

    };
in pkgs.buildGoModule {
    name = "coreth";
    src = "${runGoModTidy pkgs.buildPackages.go_1_15}/patched";
    vendorSha256 = "sha256:0xdki543lw1h0kd9pnp106w55xaamwfcvd9k47jrmvynr3jdpmmp";
    runVend = true;
    doCheck = false;
    buildPhase = ''
      mkdir -p $out
      mkdir -p $out/bin
      go build -o $out/bin/evm $src/plugin/*.go
    '';
    dontInstall = true;
}
