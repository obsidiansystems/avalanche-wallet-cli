{ pkgs ? import ./nixpkgs.nix }:
let
  coreth = (import ./coreth.nix) {};
    fetchThunk = p:
      if builtins.pathExists (p + /git.json)
        then pkgs.fetchgit { inherit (builtins.fromJSON (builtins.readFile (p + /git.json))) url rev sha256; }
      else if builtins.pathExists (p + /github.json)
        then pkgs.fetchFromGitHub { inherit (builtins.fromJSON (builtins.readFile (p + /github.json))) owner repo rev sha256; }
      else p;
in
  pkgs.buildGoModule {
  name = "gecko";
  src = fetchThunk ./dep/gecko;
  # Note, if the package's go.mod file changes, change this to pkgs.lib.fakeSha256
  # or else nix will automatically use the derivation for the matching hash and
  # go mod will complain about you missing packages (when instead, it should be complaining
  # about the wrong hash
  vendorSha256 = "1z6iy389j5an2qsjfjib2hcal0fpqkj49qarcib5vlgsy7skmnzw";
  doCheck = false;
  buildPhase = ''
    mkdir -p $out
    mkdir -p $out/bin
    mkdir -p $out/plugins
    cp ${coreth}/bin/evm $out/plugins/evm
    go build -mod=vendor -o $out/bin/avalanche "$src/main/"*.go
  '';
  dontInstall = true;
}

