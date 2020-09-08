let
  pkgs = import (builtins.fetchTarball {
    name = "nixos-20-03";
    url = "https://github.com/NixOS/nixpkgs/archive/20.03.tar.gz";
    sha256 = "0182ys095dfx02vl2a20j1hz92dx3mfgz2a6fhn31bqlp1wa8hlq";
  }) {};
  reflex-platform = import (pkgs.fetchFromGitHub {
    owner = "reflex-frp";
    repo = "reflex-platform";
    rev = "9779ea3b4c87fdc971057c561262696d5e9b1847";
    sha256 = "0v87ilal9355xwz8y9m0zh14pm9c0f7pqch0854kkj92ybc5l62q";
  }) {};
in pkgs // { fetchThunk = reflex-platform.nixpkgs.hackGet; }
