# Avalanche Wallet CLI

## Installing dependencies

The repo is currently set up for local dev of ledgerjs.

```
$ git submodule update --recursive --init
$ nix-shell
[nix-shell:~]$ yarn install
```

## Running during dev

```
$ nix-shell
[nix-shell:~]$ yarn node cli/cli.js --help
```

## Building an executable

This currently doesn't work on NixOS, see: https://github.com/NixOS/nixpkgs/pull/48193/files#diff-329ce6280c48eac47275b02077a2fc62R29
I was able to make this work in an Ubuntu VM.

```
$ nix-shell
[nix-shell:~]$ yarn build
```
