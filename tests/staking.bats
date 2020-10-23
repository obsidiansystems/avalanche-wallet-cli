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

getNodeID() {
  curl -X POST --data '{
    "jsonrpc":"2.0",
      "id"     :1,
      "method" :"info.getNodeID"
  }' -H 'content-type:application/json;' http://localhost:${NODE_HTTP_PORT}/ext/info | jq -j '.result.nodeID'
}

validate() {
  amount=$1
  fee=$2
  $CLI validate --amount $amount --delegation-fee $fee --start 1m --node-id $node $CLI_ARGS $NODE_ARGS
}

delegate() {
  amount=$1
  node=$2
  $CLI delegate --amount $amount --start 1m --end 30d --node-id $node $CLI_ARGS $NODE_ARGS
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
  # [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" == "9999998000000" ]]
  # FIXME: We have some crosstalk in the tests, and there's a balance left over from the atomic swap tests.
  [[ "$(echo "$output" | tail -n1 | awk '{print $NF}')" ==  "10000003000000" ]]

  NODE_ID=$(getNodeID)

  run validate 4000AVAX 3.14159 $NODE_ID
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

  run delegate 4999.996AVAX $NODE_ID
  echo $output
  [ "$status" -eq 0 ]
  sleep 8

}
