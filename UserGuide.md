
*  General Operations

`help [command]`						Display help information

`list-devices`                              List all connected Ledger devices

`get-app-details [options]`                 Get details about the running Ledger app

`get-device-model [options]`                Get the device model of the connected ledger

`get-wallet-id [options]`					Get the wallet ID of the connected ledger

`get-default-fee [options]`                 Get the default TX fee for this chain

`get-fee [options]`                         Get the TX fee for this chain

*   X, P, C Chain Operations

`export [options]`                          Export AVAX to another chain

`import [options]`                          Import AVAX from a different chain

`get-address [options] <path>`              Get the address of a derivation path. <path> should be 'change/address_index'

`get-extended-public-key [options] [path]`  Get the extended public key of a derivation path. <path> should be 'change/address_index'

`get-balance [options] [address]`           Get the AVAX balance of this wallet or a particular address

`get-new-receive-address [options]`         Get a fresh address for receiving funds

`transfer [options]`                        Transfer AVAX between addresses, only available on X and C Chains.

*  P Chain Only Operations

`validate [options]`                        Add a validator

`delegate [options]`                        Delegate stake to a validator

`list-validators [options]`                 List validators

`get-min-stake [options]`                   Get the minimum amount of AVAX required for validation and delegation

*  C Chain Only Operations

`deposit [options]`                         Deposit an ANTs into an ERC-20

`transfer [options]`                        Transfer ANTs between addresses

*  Options

`--network <avax, fuji, local>`             The network to use in the operation

`--chain <X, P, C>`                         Specific chain to use in the operation. For import to X, this specifies the sending chain.

`--to <receiving address>`                  Recommend using result of `get-new-receive-address`

`--amount <number>`                         For AVAX you can use units of AVAX or nAVAX. For other assets this is in whole units

`-n, --node <uri>`                          This is optional as `--network` will default to the appropriate public node

`--start-time <time>`                       Staking Start time, relative to now (e.g. 10d5h30m), or absolute (2020-10-20 18:00) (default: "10m")

`--end-time <time>`                         Staking End time, relative to the start time (e.g. 10d5h30m), or absolute (2020-10-20 18:00) (default: "365d")

`--reward-address <address>`                P-Chain address that staking rewards should be delivered to. If not provided, the next receiving address is used

`--delegation-fee <fee>`                    Delegation fee when validating, percent

`--node-id <node-id>`                       The NodeID to be used in validating

`--dest <C-0x address>`                    Use for imports to C-Chain, eth-style address that can sign for `--to`

`--assetID <uint256>`                       AssetID for C-Chain `transfer` of ANTs and `deposit`

`--device <deviceID>`                       Use the ID desired from `list-devices` 

`--wallet <walletID>`                       Use a device with this wallet ID

`--speculos <apdu-port>`                    (for testing) Use the Ledger Speculos transport instead of connecting via USB; overrides `--device`

`--speculos-button-port <port>`             (requires --speculos) Use the given port for automatically interacting with speculos buttons

`--speculos-automation-port <port>`         (requires --speculos) Use the given port for automatically interacting with speculos screens

`-h, --help`                                Display help for a specific command
