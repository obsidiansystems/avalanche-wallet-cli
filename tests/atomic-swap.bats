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
  $CLI export --amount $amount --to $toAccount $CLI_ARGS $NODE_ARGS
}

atomicSwapImport(){
  toAccount=$1
  $CLI import --to $toAccount $CLI_ARGS $NODE_ARGS
}

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Ledger app scenario 1" {
  run getBalanceXChain
  echo $output
  [ "$status" -eq 0 ]
  [[ $(echo "$output" | tail -n 1) == "0" ]]

  run setupLedgerFromFaucet
  [ "$status" -eq 0 ]

  run getBalanceXChain
  [ "$status" -eq 0 ]
  [[ "$(echo $output | awk '{print $NF}')" == "10000000" ]]

  echo "Starting Atomic Swap Tests"

  run getNewReceiveAddressPChain
  [ "$status" -eq 0 ]
  export P_CHAIN_ADDRESS=$(echo "$output" | tail -n1 | awk '{print $NF}')

  run getBalancePChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "0" ]]

  run atomicSwapExport 4000000 $P_CHAIN_ADDRESS
  [ "$status" -eq 0 ]
  sleep 8

  run getBalanceXChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "5000000" ]]

  run getBalancePChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "0" ]]

  run atomicSwapImport $P_CHAIN_ADDRESS
  [ "$status" -eq 0 ]
  sleep 8

  run getBalancePChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "3000000" ]]

  run getNewReceiveAddressXChain
  [ "$status" -eq 0 ]
  export X_CHAIN_ADDRESS=$(echo "$output" | tail -n1 | awk '{print $NF}')

  run atomicSwapExport 2000000 $X_CHAIN_ADDRESS
  [ "$status" -eq 0 ]
  sleep 8

  run getBalancePChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "0" ]]

  run atomicSwapImport $X_CHAIN_ADDRESS
  [ "$status" -eq 0 ]
  sleep 8

  run getBalanceXChain
  [ "$status" -eq 0 ]
  echo $output
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "6000000" ]]

  # Set the balance to zero for other tests

  run atomicSwapExport 5000000 $P_CHAIN_ADDRESS
  [ "$status" -eq 0 ]
  sleep 8

  run getBalanceXChain
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "0" ]]

}
