{ pkgs ? import ./nixpkgs.nix }:
let
  coreth = import ./coreth.nix {};
in pkgs.buildGoModule {
  name = "gecko";
  src = pkgs.fetchThunk ./dep/gecko;
  # Note, if the package's go.mod file changes, change this to pkgs.lib.fakeSha256
  # or else nix will automatically use the derivation for the matching hash and
  # go mod will complain about you missing packages (when instead, it should be complaining
  # about the wrong hash
  vendorSha256 = "sha256:0sx019m0x5nydqlmxhy4388c2brhgd6jvibs99ahdsy4r7351a8v";
  runVend = true;
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

