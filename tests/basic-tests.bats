source $TEST_ENV

#TODO: Add these as part of $TEST_ENV
NODE_ADDRESS='http://localhost:9652'
APDU_PORT='9999'

getAddress(){
  $CLI get-address --speculos $APDU_PORT --network local '0/1'
}

getBalance(){
  $CLI get-balance --speculos $APDU_PORT -n $NODE_ADDRESS --network local
}

@test "Ledger app extended-key" {
  run getAddress
  [ "${status}" -eq 0 ]
  [[ $(echo "${output}" | tail -n 1) == "X-local1drppshkst2ccygyq37m2z9e3ex2jhkd2j49aht" ]]
}

@test "CLI can get initial balance of 0 from the node" {
  run getBalance
  [ "${status}" -eq 0 ]
  [[ $(echo "${output}" | tail -n 1) == "0" ]]
}
