# Test Plan for Avalanche Wallet CLI

You need access to a Ledger Nano S, and you should have already installed the
latest version of the Avalanche ledger app from
https://github.com/obsidiansystems/ledger-app-avax.

Get a fresh copy of this repo:

```
git clone https://github.com/obsidiansystems/avalanche-wallet-cli.git avalanche-wallet-cli-test --recursive
cd avalanche-wallet-cli-test
git checkout <git commit that you are testing>
```

You should now follow the instructions in the README.md file to install all
dependencies. Following them should get you into a position where you can run
`cli/cli.js --help` and successfully see the help text.

## list-devices

With your ledger unplugged, run `cli/cli.js list-devices`. You should see only
an empty list, `[]`, i.e. no devices are connected.

Now connect your ledger device and enter your pin code so you are in the main
menu, and run `cli/cli.js list-devices` again. Now you should see an item in the
list which looks something like `[ '/dev/hidraw7' ]` (the exact output will
likely be different for you, but there should be one entry).

## get-device-model

With your ledger unplugged, run `cli/cli.js get-device-model`. You should
receive an error saying there is no device. Now connect your ledger and enter
your pin code, and run `cli/cli.js get-device-model` again. This time you should
see output similar to this:

```js
{
  id: 'nanoS',
  productName: 'Ledger Nano S',
  productIdMM: 16,
  legacyUsbProductId: 1,
  usbOnly: true,
  memorySize: 327680,
  blockSize: 4096
}
```

With your ledger still plugged in (and in the main menu), run `cli/cli.js
list-devices` and note down where your device is connected. For example, if you
got `[ '/dev/hidraw7' ]`, your device would be located at `/dev/hidraw7` (ignore
the brackets and apostrophes).

> __Note for macOS__: you'll get a very long result from `list-devices`. It'll look
> like this:
> ```bash
> $ cli/cli.js list-devices
> [
>   'IOService:/AppleACPIPlatformExpert/PCI0@0/AppleACPIPCI/XHC1@14/XHC1@14000000/HS02@14200000/Nano S@14200000/Nano S@0/IOUSBHostHIDDevice@14200000,0'
> ]
> ```
> You should name the result you get so the following steps are easier to do:
> ```bash
> export LEDGER='IOService:/AppleACPIPlatformExpert/PCI0@0/AppleACPIPCI/XHC1@14/XHC1@14000000/HS02@14200000/Nano S@14200000/Nano S@0/IOUSBHostHIDDevice@14200000,0'
> ```
> Then in the following steps, use $LEDGER as your device instead of
> /dev/hidraw7.

Run `cli/cli.js get-device-model --device /dev/hidraw7` (but replace /dev/hidraw7
with the path you got from list-devices). You should get the same output as
running get-device-model with no --device option.

Run `cli/cli.js get-device-model --device abc`. You should get an error saying
"cannot open device with path abc".

## get-wallet-id

With your ledger plugged in and unlocked, navigate to the Avax app and open it.
Once it's open, run `cli/cli.js get-wallet-id`. You should get back a short
series of letters and numbers, e.g. `4f4c48e1aa77` If you run the command
multiple times with a particular device, you should get the same result.

## get-new-receive-address

Navigate to the web wallet https://wallet.avax.network/. If you've used this
before with your ledger (and the mnemonic phrase hasn't changed), you can
activate your wallet by typing in the password you set previously. Otherwise,
click "Access", then "Mnemonic Key Phrase". Enter the key phrase you used to set
up your ledger device. You should then see your wallet with the balance and an
address with the label

> This is your address to receive funds.

We'll now check that the CLI shows the same address as the web wallet.

With your ledger in the Avax app, run `cli/cli.js get-new-receive-address`.
You'll be prompted to accept the command on your ledger. The ledger text should
be "Provide Extended Public Key", "Derivation Path 44'/9000'/0'", and then an
address beginning with "X-" (note this address will not be the same as the web
wallet or the address shown by the CLI itself). Upon accepting this, the CLI
should return the same address as the web wallet.

Now use the faucet (https://faucet.avax.network/) to send some tokens to the
address that is displayed. Refresh your web wallet and see that the receive
address has changed.  Run `cli/cli.js get-new-receive-address` again, and check
it matches the new web wallet address.

## get-balance

Like the previous section, we'll use the web wallet and check the total balance
displayed matches the returned value by the CLI.

Run `cli/cli.js get-balance`. You will be prompted to accept the command on your
ledger. The ledger text should be "Provide Extended Public Key", "Derivation
Path 44'/9000'/0'", and then an address beginning with "X-". Upon accepting
this, the CLI should return your total balance, and this should match the web
wallet. You can get more testnet funds by following the instructions in the
get-new-receive-address section.

This function can also be used to check the balance of a particular address.

This is done by running `cli/cli.js get-balance X-address` where `X-address`
sholud be replaced by an address you've funded via the faucet. Provided you
haven't transferred, the balance of that individual address should be 20000 (the
current value the faucet provides).

## transfer

Run `cli/cli.js transfer --to X-A4ZiuDcNizdqojr4XqEBSFx9CmKuXvQSX --amount 100`.
You'll be prompted to accept a "Provide Extended Public Key" request on your
ledger. Accept this, then, a couple of seconds later, you should be prompted to
"Sign Bytes" on the ledger. Check that the long hash on the ledger device
matches the hash printed in the terminal. Depending on how your money is stored,
you may need to sign several times for different paths. Accept them all
(provided the hashes are correct) and the CLI should print:
```
Issuing TX...
iFXtVUYyH1jkcptfuJ1DkHhNG3BVW2zYygexXLGFytbCMz6kE
```
Where the last long line is your transaction hash (yours will differ). Go to
https://explorer.avax.network/tx/iFXtVUYyH1jkcptfuJ1DkHhNG3BVW2zYygexXLGFytbCMz6kE
(substitute your hash!) and check that 100 AVAX was sent to the account
X-A4ZiuDcNizdqojr4XqEBSFx9CmKuXvQSX (this is shown in the output section).

Note that the value may be much larger than 100, but the difference should be
sent to another of your addresses (it'll be the output address which isn't
X-A4ZiuDcNizdqojr4XqEBSFx9CmKuXvQSX). You can run `cli/cli.js get-balance
--list-addresses` to check that this address did indeed get the leftover funds.

## get-address

Run `cli/cli.js get-address 0/0`. You'll be prompted on your ledger device, and
it should return the address in the terminal. You should check that the address
shown on your ledger device matches the address returned in the terminal.

Also, this should match the web wallet. To check this, in the web wallet, go to
the "Manage" page in the left menu. The bottom section, "My Keys", should list
your active keys (probably only one). Within that key are a section of buttons
on the right hand side: two icons and a "View Key Phrase" button. First you must
be sure that the web wallet is using the same mnemonic phrase as your ledger
device. Click the "View Key Phrase" button and verify they match. If they don't
you must reset the web wallet and create another with the same phrase, and go
through these instructions again. If they do match, hover over the icon buttons
next to "View Key Phrase" and click the one which is labeled "Past Addresses".
You should see a list of all the addresses you've had in the past in this
wallet, ordered by the index (`#` column). If you have many addresses here, you
can check they match by running `cli/cli.js get-address 0/N` where you
substitute the number in the `#` column as `N`. So, for the third key in the
list, you'd run `cli/cli.js get-address 0/2`. You don't need to check them all,
just pick a few.

## get-extended-public-key

Run `cli/cli.js get-extended-public-key 0/0`. You should be prompted on your ledger
device to "Provide Extended Public Key". The path displayed on your ledger
should match the path printed in the terminal. The extended public key returned should look something like:

```
xpub661MyMwAqRbcFH27nCDjzK2FZdQPs9r4PhxYwANH7CkLqA66YiY2ji4RJVcvg4QQoMRLMyRG8Y3y5c7cCu5fkU1wdUA7pmSZQrJ5rwsQAW1
```

## get-app-details

Run `cli/cli.js get-app-details`. This should immediately return with the ledger
app version and git commit. The git commit should match the version you
installed.
