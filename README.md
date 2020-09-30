# Avalanche Wallet CLI

![Yarn CI](https://github.com/obsidiansystems/avalanche-wallet-cli/workflows/Yarn%20CI/badge.svg?branch=master)

## Installing on Mac and Linux

### Brew Package Manager (Mac)

MacOS users running the [Homebrew Package Manager](www.brew.sh) can run:

```bash
brew tap obsidiansystems/avalanche-wallet-cli

brew install --HEAD obsidiansystems/avalanche-wallet-cli/avalanche-wallet-cli
```
In a few cases users have reported issues with installing the brew package when node/NPM/NVM was installed on the host machine by a method other than brew. For this issue, we recommend that you use `brew uninstall avalanche-wallet-cli`, completely remove node/NPM/NVM, and retry the install again. You can test whether node still exist by using `node -v` which should return an error. You do not need to reinstall node as it will be added as a dependency during the CLI install process.

### Snap Package Manager (Ubuntu and other Linux versions)

Snap comes out-of-the-box for Ubuntu 16.04 and later. If your host machine does not have snap installed you can find instructions for many Linux distributions from the [official Snapcraft documentaion](https://snapcraft.io/docs).

To install the CLI, download the lastest snap package from the assets dropdown of the [available releases](https://github.com/obsidiansystems/avalanche-wallet-cli/releases) and use:
```bash
snap install --devmode avalanche-wallet-cli.snap
```

### Nix Package Manager (Other)

If you have the [Nix package manager](https://nixos.org/) installed, you can install the CLI by checking out the git repository, and running the following command from the repository's top level directory:

```bash
$(nix-build)/bin/avalanche-ledger-cli
```
or, for development purposes:
```bash
$ nix-shell
[nix-shell:~]$ yarn install --frozen-lockfile
```

## Running the CLI
Once installed, the CLI will be available using:
```bash
avalanche-cli
```
