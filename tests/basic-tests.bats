getAddress(){
  $CLI get-address '0/1' $CLI_ARGS
}

getBalance(){
  $CLI get-balance $CLI_ARGS $NODE_ARGS
}

@test "Ledger app extended-key" {
  echo "$CLI_ARGS"
  run getAddress
  echo "$output"
  [ "$status" -eq 0 ]
  [[ $(echo "$output" | tail -n 1) == "X-local1drppshkst2ccygyq37m2z9e3ex2jhkd2j49aht" ]]
}

@test "CLI can get initial balance of 0 from the node" {
  run getBalance
  [ "$status" -eq 0 ]
  [[ $(echo "$output" | tail -n 1) == "0" ]]
}
