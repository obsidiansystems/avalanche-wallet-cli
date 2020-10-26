setupLedgerFromFaucet(){
  $FAUCET fund-ledger 2000000 $SPECULOS_ARGS $NODE_ARGS
}

getNewReceiveAddressXChain(){
  $CLI get-new-receive-address --chain X $CLI_ARGS $NODE_ARGS | tail -n 1
}

getNewReceiveAddressPChain(){
  $CLI get-new-receive-address --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalanceXChain(){
  $CLI get-balance $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalancePChain(){
  $CLI get-balance --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

atomicSwapExport(){
  amount=$1
  toAccount=$2
  $CLI export --amount "$amount" --to $toAccount $CLI_ARGS $NODE_ARGS
}

atomicSwapImport(){
  toAccount=$1
  $CLI import --to $toAccount $CLI_ARGS $NODE_ARGS
}

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Ledger app scenario 1" {
  [[ "$(getBalanceXChain)" == "0 nAVAX" ]]

  setupLedgerFromFaucet

  [[ "$(getBalanceXChain)" == "10000000 nAVAX" ]]

  echo "Starting Atomic Swap Tests"

  P_CHAIN_ADDRESS=$(getNewReceiveAddressPChain)

  [[ "$(getBalancePChain)" == "0 nAVAX" ]]

  atomicSwapExport "4000000 nAVAX" $P_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceXChain)" == "5000000 nAVAX" ]]

  [[ "$(getBalancePChain)" == "0 nAVAX" ]]

  atomicSwapImport $P_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalancePChain)" == "3000000 nAVAX" ]]

  X_CHAIN_ADDRESS=$(getNewReceiveAddressXChain)

  atomicSwapExport "2000000 nAVAX" $X_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalancePChain)" == "0 nAVAX" ]]

  atomicSwapImport $X_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceXChain)" == "6000000 nAVAX" ]]

  # Set the balance to zero for other tests

  atomicSwapExport "5000000 nAVAX" $P_CHAIN_ADDRESS
  sleep 8

  [[ "$(getBalanceXChain)" == "0 nAVAX" ]]

}
