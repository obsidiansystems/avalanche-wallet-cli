# Avalanche Wallet CLI

![Yarn CI](https://github.com/obsidiansystems/avalanche-wallet-cli/workflows/Yarn%20CI/badge.svg?branch=master)

## Installing dependencies

The repo is currently set up for local dev of ledgerjs.

```
$ git submodule update --recursive --init
$ nix-shell
[nix-shell:~]$ yarn install
```
#### Installation of NVM

First download the NVM installation script using `curl`:
```
$ curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash
```
After downloading the script, change to the .nvm folder and run the script using `bash`:
```
$ cd ~/.nvm
$ bash install.sh
```
To reflect the changes for the current user session, use the following command:
```
$ source ~/.profile
```

#### Installation of Node.js

Install the specific node version required using `nvm`:
```
$ nvm install 12.14 # it will install node 12.14.1
```
Set the particular node version to use:
```
$ nvm use 12.14 # it will use node 12.14.1
```
To check the node version, use:
```
$ node -v
```

#### Installation of Yarn
Install the specific yarn version required using `npm`:
```
$ npm install yarn@1.22.4 # it will install yarn 1.22.4
```
To check the yarn version, use:
```
$ yarn -v
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
