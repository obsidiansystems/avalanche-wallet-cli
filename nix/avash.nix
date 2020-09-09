{ pkgs ? import ./nixpkgs.nix }:
pkgs.buildGoModule {
  name = "avash";
  src = import ./dep/avash/thunk.nix;

  # The import being removed below messes up `go mod vendor` as it seems to be unnecessary
  preConfigure = ''
     substituteInPlace ./wallets/chains/wallet.go --replace '"github.com/ava-labs/gecko/modules/chains/payments"' ""
    '';

  overrideModAttrs = old: {
    # Do it here becuase the src passed into the dependency derivation does't get touched by the above preconfigure
    preConfigure = ''
       substituteInPlace ./wallets/chains/wallet.go --replace '"github.com/ava-labs/gecko/modules/chains/payments"' ""
      '';
  };
  buildPhase = ''
    mkdir -p $out
    mkdir -p $out/bin
    go build -mod=vendor -o $out/bin/avash main.go
  '';
  dontInstall = true;
  doCheck = false;

  # Note, if the package's go.mod file changes, change this to pkgs.lib.fakeSha256
  # or else nix will automatically use the derivation for the matching hash and
  # go mod will complain about you missing packages (when instead, it should be complaining
  # about the wrong hash
  vendorSha256 = "0zhqhzmw9719857ay11l11jh1vmngjkmgbchqijbr28dw2j52wvz";
}
