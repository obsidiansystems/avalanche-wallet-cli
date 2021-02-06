FAKE_USER="X-local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve"

getAddress(){
  path=$1
  $CLI get-address $path $CLI_ARGS | tail -n 1
}

getBalance(){
  $CLI get-balance $@ $CLI_ARGS $NODE_ARGS | tail -n 1
}

setupLedgerFromFaucet(){
  $FAUCET fund-ledger 75000000 $SPECULOS_ARGS $NODE_ARGS
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

ANT=wkKfT9FQZsmeZ7bJZc2gU8vib3GRRJp2BmAxCM4gshQ2g6BbY

# bats will run each test multiple times, so to get around this (for the time being) we
# run everything in a single test case
@test "Basic tests" {
  [[ $(getAddress '0/1') == "X-local1drppshkst2ccygyq37m2z9e3ex2jhkd2j49aht" ]]

  [[ $(getBalance) == "0 nAVAX" ]]

  setupLedgerFromFaucet

  [[ "$(getBalance)" == "375000000 nAVAX" ]]
  assertTest "$(getBalance "--assetID $ANT")" == "5000"

  transfer "3000000 nAVAX" $FAKE_USER
  sleep 1.5

  [[ "$(getBalance)" == "371000000 nAVAX" ]]

  # Transfer the rest away so we are clean for other tests
  transfer "370000000 nAVAX" $FAKE_USER
  sleep 1.5

  [[ "$(getBalance)" == "0 nAVAX" ]]
}
