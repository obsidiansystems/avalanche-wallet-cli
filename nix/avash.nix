{ pkgs ? import <nixpkgs> {} }:
pkgs.buildGoModule {
  name = "avash";
  src = import ./dep/avash/thunk.nix;

  # The import being removed below messes up `go mod vendor` as it seems to be unnecessary
  preConfigure = ''
     substituteInPlace ./wallets/chains/wallet.go --replace '"github.com/ava-labs/gecko/modules/chains/payments"' "" 
    '';
  buildPhase = ''
    mkdir -p $out
    mkdir -p $out/bin
    go build -mod=vendor -o $out/bin/avash main.go
  '';
  dontInstall = true;
  doCheck = false;

  vendorSha256 = "0zhqhzmw9719857ay11l11jh1vmngjkmgbchqijbr28dw2j52wvz";
}
