let
  pkgs = import (builtins.fetchTarball {
    name = "nixos-20-03";
    url = "https://releases.nixos.org/nixos/20.09/nixos-20.09.2497.4a75ca4a4e7/nixexprs.tar.xz";
    sha256 = "sha256:1iy21bv97c9mplhmy2kvv1wi1blb1m4l18b1dk2sbdd543pgzg2x";
  }) {};
  reflex-platform = import (pkgs.fetchFromGitHub {
    owner = "reflex-frp";
    repo = "reflex-platform";
    rev = "9779ea3b4c87fdc971057c561262696d5e9b1847";
    sha256 = "0v87ilal9355xwz8y9m0zh14pm9c0f7pqch0854kkj92ybc5l62q";
  }) {};
in pkgs // { fetchThunk = reflex-platform.nixpkgs.hackGet; }
