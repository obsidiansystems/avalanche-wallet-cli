# Avalanche Wallet CLI

## Installing dependencies

The repo is currently set up for local dev of ledgerjs.

```
$ git submodule update --recursive --init
$ nix-shell -p libusb1 pkgconfig yarn nodejs libudev.dev
[nix-shell:~]$ yarn install
```

`yarn setup` is a script defined in package.json which links the packages we are using.

## Running

```
$ nix-shell -p libusb1 pkgconfig yarn nodejs libudev.dev
[nix-shell:~]$ yarn node ./cli.js
```
