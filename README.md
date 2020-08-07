# Avalanche Wallet CLI

![Yarn CI](https://github.com/obsidiansystems/avalanche-wallet-cli/workflows/Yarn%20CI/badge.svg?branch=master)

## Installing dependencies

The repo is currently set up for local dev of ledgerjs.

```
$ nix-shell
[nix-shell:~]$ yarn install
```
### Ubuntu 20.04 LTS Dependencies

Ubuntu user will require several libraries using `apt`. APT is a package tool that should have been installed with the operating system. If not, please see the user documentation for your release.

Update `apt`, Debian's Application Package Tool
```
$ sudo apt update
```
Install the neccessary libraries using `apt`
```
$ sudo apt install libusb-1.0-0-dev -y
$ sudo apt install libudev1 -y
$ sudo apt install libudev-dev -y
```
#### Installation of NVM

First download the NVM installation script using `curl`:
```
$ curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash
```
To reflect the changes for the current user session, use the following command:
```
$ source ~/.profile
```

#### Installation of Node.js

Install the specific node version required using `nvm`:
```
$ nvm install 12.14 # this will install node 12.14.1
```
Set the particular node version to use:
```
$ nvm use 12.14 # this will use node 12.14.1
```
To check the node version, use:
```
$ node -v
```

#### Installation of Yarn

Ubuntu 20.04 LTS has a known issue that can occur when installing `yarn`. To prevent this from happening, we reccommend using the commands:
```
$ sudo apt remove cmdtest #removes the offending package
$ sudo apt remove yarn #removes any yarn versions already installed
```
Install the specific yarn version required using `apt-get`:
```
$ curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
$ echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
$ sudo apt-get install yarn # this will install yarn 1.22.4
```
To check the yarn version, use:
```
$ yarn -v
```

### MacOS Dependencies

#### Installation of NVM (Node Version Manager)

First download the NVM installation script using `curl`:
```
$ curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash
```
To reflect the changes for the current user session, use the following command:
```
$ source ~/.profile
```

#### Installation of Node.js

Install the specific node version required using `nvm`:
```
$ nvm install 12.14 # it will install node 12.14.1 and npm (Node Package Manager)
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
$ npm install yarn 1.22.4 # it will install yarn 1.22.4
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
