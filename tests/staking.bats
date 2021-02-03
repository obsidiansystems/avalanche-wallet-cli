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
  $CLI export --amount "$amount" --to $toAccount $CLI_ARGS $NODE_ARGS
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
  node=$3
  $CLI validate --amount $amount --delegation-fee $fee --start-time 1m --end-time 30d --node-id $node $CLI_ARGS $NODE_ARGS
}

delegate() {
  amount=$1
  node=$2
  $CLI delegate --amount "$amount" --start-time 1m --end-time 30d --node-id $node $CLI_ARGS $NODE_ARGS
}

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Staking" {

  setupLedgerFromFaucet

  [[ "$(getBalanceXChain)" == "10000000000000 nAVAX" ]]

  P_CHAIN_ADDRESS=$(getNewReceiveAddressPChain)

  atomicSwapExport "9999.999 AVAX" $P_CHAIN_ADDRESS
  sleep 1.5

  atomicSwapImport $P_CHAIN_ADDRESS
  sleep 1.5

  [[ "$(getBalancePChain)" == "9999998000000 nAVAX" ]]

  NODE_ID=$(getNodeID)

  validate 4000AVAX 3.14159 $NODE_ID
  sleep 1.5

  delegate 4999.996AVAX $NODE_ID
  sleep 1.5

}
