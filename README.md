# Avalanche Wallet CLI

![Yarn CI](https://github.com/obsidiansystems/avalanche-wallet-cli/workflows/Yarn%20CI/badge.svg?branch=master)

## Installing on Linux and Mac with a package manager

### Brew Package Manager (Mac)

```brew tap obsidiansystems/avalanche-wallet-cli
brew install --HEAD --verbose --debug obsidiansystems/avalanche-wallet-cli/avalanche-wallet-cli
```

In some cases, users have reported an issue with installing the brew package when Node/NPM/NVM was installed on the host machine by a methed other than brew. For this issue, we recommend that you `brew uninstall avalanche-wallet-cli` and completely remove node modules before retrying the install. You do not need to install node from brew as it will be added as a dependency during the CLI install process.

### Snap Package Manager (Ubuntu)

Download the lastest snap package 
```
snap install --devmode avalanche-wallet-cli.snap
```

### Nix Package Manager (Other)

If you have the package manager https://nixos.org/ installed, just run:
```bash
$ git submodule update --init --recursive
$(nix-build)/bin/avalanche-ledger-cli
```
or, for development purposes:
```bash
$ git submodule update --init --recursive
$ nix-shell
[nix-shell:~]$ yarn install --frozen-lockfile
```
