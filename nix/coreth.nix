{ pkgs ? import <nixpkgs> {} }:
pkgs.buildGoModule {
    name = "coreth";
    src = import ./dep/coreth/thunk.nix;

    # We use the antiquated modSha256 here, instead of the newer vendorSha256 because of this 
    # go issue: https://github.com/golang/go/issues/26366
    # This basically states that go mod vendor does not pull in sub directories not containing any go files
    # This is an issue for libraries like https://github.com/karalabe/usb that contain C deps, and explicitly
    # reference the path to these dirs in their package.
    # One solution could be to patch these libs with dummy.go files, another could be to use 
    # nixpkgs.buildGoModule's support for https://github.com/nomad-software/vend via
    # `runVend = true;`
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
