{ pkgs ? import <nixpkgs> {} }:
let
  coreth = (import ./coreth.nix) {};
in 
  pkgs.buildGoModule {
  name = "gecko";
  src = import ./dep/gecko/thunk.nix;
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

