{ pkgs ? import <nixpkgs> {} }:
pkgs.buildGoModule {
    name = "coreth";
    src = import ./dep/coreth/thunk.nix;
    modSha256 = "1nss6kc3qvli16f36ij0kh52r62f29s5q1qpvbh91f0mvj6n1ylc";
    vendorSha256 = null;
    doCheck = false;
    buildPhase = '' 
      mkdir -p $out
      mkdir -p $out/bin
      go build -o $out/bin/evm $src/plugin/*.go
    '';
    dontInstall = true;
}
