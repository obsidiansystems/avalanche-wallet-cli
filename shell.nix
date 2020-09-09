{ pkgs ? import ./nix/nixpkgs.nix }:
let
  nodeVersion = "12.14.1";
  nodeSha256 = "1nvsivl496fgaypbk2pqqh7py29g7wsggyjlqydy1c0q4f24nyw7";
  nodejs = pkgs.nodejs-12_x.overrideAttrs (oldAttrs: {
    name = "nodejs-${nodeVersion}";
    version = nodeVersion;
    src = pkgs.fetchurl {
      url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}.tar.xz";
      sha256 = nodeSha256;
    };
  });
in pkgs.mkShell {
  buildInputs = [ pkgs.pkgconfig pkgs.python pkgs.libusb1 pkgs.libudev.dev nodejs pkgs.yarn ];
}
