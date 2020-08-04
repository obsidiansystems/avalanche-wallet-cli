{ pkgs ? import (builtins.fetchTarball {
    name = "nixos-20-03";
    url = "https://github.com/nixos/nixpkgs/archive/release-20.03.tar.gz";
    sha256 = "164j4h71pc6419762zbbmc6f2q727971l8f2vv3wkry827r47gbk";
  }) {}
}:
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
  buildInputs = [ pkgs.pkgconfig pkgs.libusb1 pkgs.libudev.dev nodejs pkgs.yarn ];
}
