# Avalanche Wallet CLI

![Yarn CI](https://github.com/obsidiansystems/avalanche-wallet-cli/workflows/Yarn%20CI/badge.svg?branch=master)

## Installing dependencies

### Systems with Nix installed

If you have the package manager https://nixos.org/ installed, just run:
```
$ nix-shell
[nix-shell:~]$ yarn install
```

### Systems without Nix installed

#### Ubuntu 20.04 LTS Additional Dependencies

Ubuntu user will require several libraries using `apt`. APT is a package tool that should have been installed with the operating system. If not, please see the user documentation for your release.

Update `apt`, Debian's Application Package Tool
```
$ sudo apt update
```
Install the neccessary libraries and tools using `apt`
```
$ sudo apt install libusb-1.0-0-dev libudev1 libudev-dev make g++
```

You can now follow the rest of the instructions in this section.

#### Installation of NVM

NVM is a tool for provisioning particular versions of Node.js. First download the NVM installation script using `curl`:
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
$ nvm install 12.14.1
$ nvm use 12.14.1
```
To check the node version, use:
```
$ node -v
```

#### Installation of Yarn

> __Note for Ubuntu users:__ Ubuntu 20.04 LTS has a known issue that can occur when installing `yarn`. To prevent this from happening, we recommend using the commands:
> ```
> $ sudo apt remove cmdtest
> $ sudo apt remove yarn
> ```
Install the specific yarn version required using `npm`:
```
$ npm install yarn -g
```

#### Installation of JavaScript dependencies

Run `yarn install` from the top level directory of this project.

## Running the CLI

```
$ yarn node cli/cli.js --help
```

You can also omit the `yarn node` portion:

```
$ cli/cli.js --help
```

## Building an executable

This currently doesn't work on NixOS, see: https://github.com/NixOS/nixpkgs/pull/48193/files#diff-329ce6280c48eac47275b02077a2fc62R29
I was able to make this partially work in an Ubuntu VM.

```
$ yarn build
```
