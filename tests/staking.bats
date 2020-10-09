setupLedgerFromFaucet(){
  $FAUCET fund-ledger 2000000000000 $SPECULOS_ARGS $NODE_ARGS
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

validate() {
  amount=$1
  fee=$2
  $CLI validate --amount $amount --delegation-fee $fee --start 1m $CLI_ARGS $NODE_ARGS
}

delegate() {
  amount=$1
  $CLI delegate --amount $amount --start 1m --end 30d $CLI_ARGS $NODE_ARGS
}

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Ledger app scenario 1" {

  run setupLedgerFromFaucet
  [ "$status" -eq 0 ]

  run getBalanceXChain
  echo $output
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "10000000000000" ]]

  echo "Starting Staking Tests"

  run getNewReceiveAddressPChain
  [ "$status" -eq 0 ]
  export P_CHAIN_ADDRESS=$(echo "$output" | tail -n1 | awk '{print $NF}')

  run atomicSwapExport 9999.999AVAX $P_CHAIN_ADDRESS
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

  run atomicSwapImport $P_CHAIN_ADDRESS
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

  run getBalancePChain
  echo $output
  [ "$status" -eq 0 ]
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "9999998000000" ]]

  run validate 4000AVAX 3.14159
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

  run delegate 4999.996AVAX
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

}
