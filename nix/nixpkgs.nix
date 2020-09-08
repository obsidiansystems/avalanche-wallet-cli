let
  pkgs = import (builtins.fetchTarball {
    name = "nixos-20-03";
    url = https://releases.nixos.org/nixos/20.03/nixos-20.03.2910.42674051d12/nixexprs.tar.xz;
    sha256 = "1fx13qspanv71b8r2ryc259ml9wmkhkcjv3m84jadbzi2z68qj9i";
  }) {};
  reflex-platform = import (pkgs.fetchFromGitHub {
    owner = "reflex-frp";
    repo = "reflex-platform";
    rev = "9779ea3b4c87fdc971057c561262696d5e9b1847";
    sha256 = "0v87ilal9355xwz8y9m0zh14pm9c0f7pqch0854kkj92ybc5l62q";
  }) {};
in pkgs // { fetchThunk = reflex-platform.nixpkgs.hackGet; }
