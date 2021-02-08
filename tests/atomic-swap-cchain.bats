setupLedgerFromFaucet(){
  $FAUCET fund-ledger 20000000000000 $SPECULOS_ARGS $NODE_ARGS
}

getNewReceiveAddressXChain(){
  $CLI get-new-receive-address --chain X $CLI_ARGS $NODE_ARGS | tail -n 1
}

getNewReceiveAddressPChain(){
  $CLI get-new-receive-address --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

getNewReceiveAddressCChain(){
  $CLI get-new-receive-address --chain C $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalanceXChain(){
  $CLI get-balance $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalancePChain(){
  $CLI get-balance --chain P $CLI_ARGS $NODE_ARGS | tail -n 1
}

getBalanceCChain(){
  $CLI get-balance $@ --chain C $CLI_ARGS $NODE_ARGS | tail -n 1
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

deposit(){
  amount=$1
  toAccount=$2
  if [ "$#" -eq 3 ]; then
    assetID="--assetID $3"
  else
    assetID=""
  fi
  $CLI deposit --amount "$amount" --to $toAccount $assetID $CLI_ARGS $NODE_ARGS
}

transfer(){
  amount=$1
  toAccount=$2
  if [ "$#" -eq 3 ]; then
    assetID="--assetID $3"
  else
    assetID=""
  fi
  $CLI transfer --amount "$amount" --to $toAccount $assetID $CLI_ARGS $NODE_ARGS
}

assertTest(){
  if test "$@" ; then
    return 0
  else
    echo "expected: " "$@"
    exit 1
  fi
}

ANT_A=verma4Pa9biWKbjDGNsTXU47cYCyDSNGSU1iBkxucfVSFVXdv

@test "Atomic swap C-chain" {

  # set -x
  assertTest "$(getBalanceXChain)" == "0 nAVAX"

  setupLedgerFromFaucet

  assertTest "$(getBalanceXChain)" == "100000000000000 nAVAX"

  echo "Starting Atomic Swap Tests"

  C_CHAIN_RECIEVE_ADDRESS=$(getNewReceiveAddressCChain)
  echo "C_CHAIN_RECIEVE_ADDRESS=${C_CHAIN_RECIEVE_ADDRESS}"

  C_CHAIN_ADDRESS=$(getAddressCChain)
  echo "C_CHAIN_ADDRESS=${C_CHAIN_ADDRESS}"

  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "0 WEI"
  assertTest "$(getBalanceCChain "--assetID $ANT_A")" == "0x0"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS --assetID $ANT_A")" == "0x0"
  echo "atomicSwapExport X->C"

  $CLI export --amount "40000000000000 nAVAX" --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" $CLI_ARGS $NODE_ARGS
  sleep 1.5

  assertTest "$(getBalanceXChain)" == "59999999000000 nAVAX"

  assertTest "$(getBalanceCChain)" == "0 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "0 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_RECIEVE_ADDRESS")" == "0 WEI"

  echo "atomicSwapImport X->C"
  $CLI import --chain "X" --to "$C_CHAIN_RECIEVE_ADDRESS" --dest "$C_CHAIN_ADDRESS" $CLI_ARGS $NODE_ARGS

  sleep 1.5

  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "40000000000000000000000 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_RECIEVE_ADDRESS")" == "0 WEI"

  # C-chain native transfer

  echo "C-chain transfer"

  C_CHAIN_TRANSFER_TARGET_ADDRESS=$(getNewReceiveAddressCChain)
  echo "C_CHAIN_TRANSFER_TARGET_ADDRESS: $C_CHAIN_TRANSFER_TARGET_ADDRESS"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "40000000000000000000000 WEI"
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS")" == "0 WEI"
  transfer "10 nAVAX" "$C_CHAIN_TRANSFER_TARGET_ADDRESS"
  sleep 1.5
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS")" == "10000000000 WEI"
  # C-chain assetCall
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS --assetID $ANT_A")" == "0x0"
  transfer "0x0" "$C_CHAIN_TRANSFER_TARGET_ADDRESS" "$ANT_A"
  sleep 1.5
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS --assetID $ANT_A")" == "0x0"
  deposit  "0x0" "$C_CHAIN_TRANSFER_TARGET_ADDRESS" "$ANT_A"
  sleep 1.5
  assertTest "$(getBalanceCChain "$C_CHAIN_TRANSFER_TARGET_ADDRESS --assetID $ANT_A")" == "0x0"

  echo "atomicSwapImport C->X"
  X_CHAIN_ADDRESS=$(getNewReceiveAddressXChain)

  EXPORT_BALANCE="$(getBalanceCChain "$C_CHAIN_ADDRESS")"
  assertTest "${EXPORT_BALANCE}" == "39999969419919999999990 WEI"

  atomicSwapExport "9999969419919 nAVAX" "C" $X_CHAIN_ADDRESS
  sleep 1.5

  echo $C_CHAIN_ADDRESS
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" != "${EXPORT_BALANCE}"

  IMPORT_BALANCE="$(getBalanceXChain)"
  atomicSwapImport "C" $X_CHAIN_ADDRESS
  sleep 1.5

  assertTest "$(getBalanceXChain)" != "${IMPORT_BALANCE}"
  assertTest "$(getBalanceXChain)" == "69999967419919 nAVAX"

  # Set the balance to zero for other tests

  atomicSwapExport "69999966419919 nAVAX" "X" "C-0xffffffffffffffffffffffffffffffffffffffff"
  transfer "29999989130000999999990 nAVAX" "C-local1llllllllllllllllllllllllllllllllnr3l6z"

  sleep 1.5

  assertTest "$(getBalanceXChain)" == "0 nAVAX"
  assertTest "$(getBalanceCChain "$C_CHAIN_ADDRESS")" == "0 WEI"
  assertTest "$(getBalanceCChain)" == "0 WEI"

}
