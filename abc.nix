{ pkgs ? import <nixpkgs> {}}:
(import ./default.nix {}).tests ../../../bin/app.elf
