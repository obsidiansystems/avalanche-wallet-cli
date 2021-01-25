setupLedgerFromFaucet(){
  $FAUCET fund-ledger 20000000000000 $SPECULOS_ARGS $NODE_ARGS
}

getNewReceiveAddressXChain(){
  $CLI get-new-receive-address --chain X $CLI_ARGS $NODE_ARGS | tail -n 1
}

getNewReceiveAddressPChain(){
  $CLI get-new-receive-address --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

getNewReceiveAddressCChain(){
  $CLI get-new-receive-address --chain C $CLI_ARGS $NODE_ARGS | tail -n 1
  # $CLI get-address --chain C "0/0" $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalanceXChain(){
  $CLI get-balance $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalancePChain(){
  $CLI get-balance --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalanceCChain(){
  $CLI get-balance $@ --chain C $CLI_ARGS $NODE_ARGS | tail -n 1
}

getAddressCChain(){
  $CLI get-address --chain C "0/0" $CLI_ARGS $NODE_ARGS | tail -n 1
}

atomicSwapExport(){
  amount=$1
  chain=$2
  toAccount=$3
  $CLI export --amount "$amount" --chain $chain --to $toAccount $CLI_ARGS $NODE_ARGS
}

atomicSwapImport(){
  chain=$1
  toAccount=$2
  $CLI import --chain $chain --to $toAccount $CLI_ARGS $NODE_ARGS
}

transfer(){
  amount=$1
  toAccount=$2
  $CLI transfer --amount "$amount" --to $toAccount $CLI_ARGS $NODE_ARGS
}

assertTest(){
  if test "$@" ; then
    return 0
  else
    echo "expected: " "$@"
    exit 1
  fi
}

ANT_A=verma4Pa9biWKbjDGNsTXU47cYCyDSNGSU1iBkxucfVSFVXdv

@test "Atomic swap C-chain" {

  # set -x
  [[ "$(getBalanceXChain)" == "0 nAVAX" ]]

  setupLedgerFromFaucet

  [[ "$(getBalanceXChain)" == "100000000000000 nAVAX" ]]

  echo "Starting Atomic Swap Tests"

  echo "get recieve address"
  C_CHAIN_RECIEVE_ADDRESS=$(getNewReceiveAddressCChain)
  echo "C_CHAIN_RECIEVE_ADDRESS=${C_CHAIN_RECIEVE_ADDRESS}"

  echo "get address"
  C_CHAIN_ADDRESS=$(getAddressCChain)
  echo "C_CHAIN_ADDRESS=${C_CHAIN_ADDRESS}"

  echo "getBalanceCChain 1"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "0 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS --assetID $ANT_A")" == "0"
  echo "atomicSwapExport"

  $CLI export --amount "40000000000000 nAVAX" --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" $CLI_ARGS $NODE_ARGS
  # # atomicSwapExport "40000000000000 nAVAX" "X" $C_CHAIN_RECIEVE_ADDRESS
  sleep 8

  assertTest "$(getBalanceXChain)" == "59999999000000 nAVAX"

  assertTest "$(getBalanceCChain)" == "0 nAVAX"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "0 WEI"

  echo "atomicSwapImport"
  $CLI import --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" --dest "$C_CHAIN_ADDRESS" $CLI_ARGS $NODE_ARGS

  sleep 8

  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "40000000000000000000000 WEI"

  # C-chain transfer
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "40000000000000000000000 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_RECIEVE_ADDRESS")" == "0 WEI"
  C_CHAIN_TRANSFER_TARGET_ADDRESS=$(getNewReceiveAddressCChain)
  echo "C_CHAIN_TRANSFER_TARGET_ADDRESS: $C_CHAIN_TRANSFER_TARGET_ADDRESS"

  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "40000000000000000000000 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS")" == "0 WEI"
  transfer "10 nAVAX" "$C_CHAIN_TRANSFER_TARGET_ADDRESS"
  sleep 8
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS")" == "10 WEI"


  X_CHAIN_ADDRESS=$(getNewReceiveAddressXChain)

  echo "export c"
  atomicSwapExport "2000000 nAVAX" "C" $X_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceCChain)" == "0 nAVAX" ]]

  atomicSwapImport "C" $X_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceXChain)" == "6000000 nAVAX" ]]

  # Set the balance to zero for other tests

  atomicSwapExport "5000000 nAVAX" "X" $C_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceXChain)" == "0 nAVAX" ]]

  [[ "$(getBalanceCChain)" == "0 nAVAX" ]]

}
