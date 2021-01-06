{ pkgs ? import ./nixpkgs.nix }: pkgs.buildGoModule {
    name = "coreth";
    src = pkgs.fetchThunk ./dep/coreth;
    vendorSha256 = "sha256:1x4xm8zzzwdk5yrdsbxv3fq7wamvigf0igjgxsny09j941jvlrna";
    runVend = true;
    doCheck = false;
    buildPhase = ''
      mkdir -p $out
      mkdir -p $out/bin
      go build -o $out/bin/evm $src/plugin/*.go
    '';
    dontInstall = true;
}
