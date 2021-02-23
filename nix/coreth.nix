{ pkgs ? import ./nixpkgs.nix }: pkgs.buildGoModule {
    name = "coreth";
    src = pkgs.fetchThunk ./dep/coreth;
    vendorSha256 = "sha256:14dwdy4p93adhsyzr3za31jdlzq905954jk1ppba6q7mr2d4is79";
    runVend = true;
    doCheck = false;
    buildPhase = ''
      mkdir -p $out
      mkdir -p $out/bin
      go build -o $out/bin/evm $src/plugin/*.go
    '';
    dontInstall = true;
}
