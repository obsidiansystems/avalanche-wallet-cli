setupLedgerFromFaucet(){
  $FAUCET fund-ledger 2000000 $SPECULOS_ARGS $NODE_ARGS
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
  $CLI get-balance --chain C $CLI_ARGS $NODE_ARGS | tail -n 1
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


@test "Atomic swap C-chain" {

  # set -x
  [[ "$(getBalanceXChain)" == "0 nAVAX" ]]

  setupLedgerFromFaucet

  [[ "$(getBalanceXChain)" == "10000000 nAVAX" ]]

  echo "Starting Atomic Swap Tests"

  echo "get recieve address"
  C_CHAIN_RECIEVE_ADDRESS=$(getNewReceiveAddressCChain)
  echo "C_CHAIN_RECIEVE_ADDRESS=${C_CHAIN_RECIEVE_ADDRESS}"

  echo "get address"
  C_CHAIN_ADDRESS=$(getAddressCChain)
  echo "C_CHAIN_ADDRESS=${C_CHAIN_ADDRESS}"

  echo "getBalanceCChain"
  [[ "$(getBalanceCChain)" == "0 nAVAX" ]]


  echo "atomicSwapExport"

  $CLI export --amount "4000000 nAVAX" --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" $CLI_ARGS $NODE_ARGS
  # # atomicSwapExport "4000000 nAVAX" "X" $C_CHAIN_RECIEVE_ADDRESS
  sleep 8

  echo "getBalanceXChain"
  [[ "$(getBalanceXChain)" == "5000000 nAVAX" ]]

  echo "getBalanceCChain"
  [[ "$(getBalanceCChain)" == "0 nAVAX" ]]

  echo "atomicSwapImport"
  $CLI import --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" --dest "$C_CHAIN_ADDRESS" $CLI_ARGS $NODE_ARGS

  sleep 8

  echo "getBalanceCChain"
  [[ "$(getBalanceCChain)" == "3000000 nAVAX" ]]

  X_CHAIN_ADDRESS=$(getNewReceiveAddressXChain)

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
