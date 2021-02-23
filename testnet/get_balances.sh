AVALANCHEGO_HOST='localhost:9652'

echo 'Getting Balance for "faucet"'
curl -X POST --data '{
  "jsonrpc":"2.0",
  "id"     : 1,
  "method" :"avm.getBalance",
  "params" :{
    "address":"X-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u",
    "assetID":"AVAX"
  }
}' -H 'content-type:application/json;' $AVALANCHEGO_HOST/ext/bc/X

echo 'Getting Balance for "test1"'
curl -X POST --data '{
  "jsonrpc":"2.0",
  "id"     : 1,
  "method" :"avm.getBalance",
  "params" :{
    "address":"X-local1r0t6cce8yece0ksdfestg87c8xuhs8fc0mvsfr",
    "assetID":"AVAX"
  }
}' -H 'content-type:application/json;' $AVALANCHEGO_HOST/ext/bc/X

echo 'Getting Balance for "test2"'
curl -X POST --data '{
  "jsonrpc":"2.0",
  "id"     : 1,
  "method" :"avm.getBalance",
  "params" :{
    "address":"X-local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve",
    "assetID":"AVAX"
  }
}' -H 'content-type:application/json;' $AVALANCHEGO_HOST/ext/bc/X
