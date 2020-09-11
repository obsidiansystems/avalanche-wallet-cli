FAKE_USER="X-local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve"

getAddress(){
  path=$1
  $CLI get-address $path $CLI_ARGS
}

getBalance(){
  $CLI get-balance $CLI_ARGS $NODE_ARGS | tail -n 1
}

setupLedgerFromFaucet(){
  $FAUCET fund-ledger 500000 $SPECULOS_ARGS $NODE_ARGS
}

transfer(){
  amount=$1
  toAccount=$2
  $CLI transfer --amount $amount --to $toAccount $CLI_ARGS $NODE_ARGS
}

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Ledger app scenario 1" {
  run getAddress '0/1'
  [ "$status" -eq 0 ]
  [[ $(echo "$output" | tail -n 1) == "X-local1drppshkst2ccygyq37m2z9e3ex2jhkd2j49aht" ]]

  run getBalance
  [ "$status" -eq 0 ]
  [[ $(echo "$output" | tail -n 1) == "0" ]]


  run setupLedgerFromFaucet
  [ "$status" -eq 0 ]

  run getBalance
  [ "$status" -eq 0 ]
  [[ "$(echo $output | awk '{print $NF}')" == "2500000" ]]

  # # echo "Starting Transfer test"
  # run transfer 200000 $FAKE_USER
  # [ "$status" -eq 0 ]
  # sleep 8

  # run getBalance
  # [ "$status" -eq 0 ]
  # echo "$output" 
  # [[ "$(echo "$output" | awk '{print $NF}')" == "2300000" ]]
}
