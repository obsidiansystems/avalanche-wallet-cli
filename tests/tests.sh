#!/usr/bin/env bash

set -euxo pipefail

#TODO: Verify that all these are set at start time
# GECKO=
# PLUGINS=
# CERTS=
# SPECULOS=
# LEDGER_APP=
# CLI=

OUTDIR="${OUTDIR:-_tests-output}"
mkdir -p "$OUTDIR"

BUTTON_PORT=8888
AUTOMATION_PORT=8899
APDU_PORT=9999

NODE_PREFIX="$GECKO --plugin-dir=$PLUGINS/"
NODE_SHARED="--assertions-enabled=true --tx-fee=1000000 --public-ip=127.0.0.1 --network-id=local --xput-server-enabled=false --signature-verification-enabled=true --api-admin-enabled=true --api-ipcs-enabled=false --api-keystore-enabled=true --api-metrics-enabled=true --http-tls-enabled=false --db-enabled=false --log-level=verbo --snow-avalanche-batch-size=30 --snow-avalanche-num-parents=5 --snow-sample-size=2 --snow-quorum-size=2 --snow-virtuous-commit-threshold=5 --snow-rogue-commit-threshold=10 --p2p-tls-enabled=true --staking-enabled=false"

NODE_HTTP_PORT=9652
export CLI_ARGS="--network local --speculos $APDU_PORT --speculos-button-port $BUTTON_PORT --speculos-automation-port $AUTOMATION_PORT"
export NODE_ARGS="--node http://localhost:$NODE_HTTP_PORT"

trap "exit" INT TERM ERR
trap "kill 0" EXIT

# Startup the node
NODE1_PID=

echo "Starting Node 1"
#TODO: This can fail without us noticing?
$NODE_PREFIX $NODE_SHARED \
  --http-port=$NODE_HTTP_PORT \
  --xput-server-port=9255 \
  --staking-port=9155 \
  --staking-tls-key-file=$CERTS/keys1/staker.key \
  --staking-tls-cert-file=$CERTS/keys1/staker.crt \
  --log-dir "$OUTDIR/node1.log" \
  &> "$OUTDIR/node1.txt" &
NODE1_PID=$!
echo "NODE_PID $NODE1_PID"
sleep 5

# Startup speculos
SPEC_PID=
echo "Starting Speculos"
$SPECULOS $LEDGER_APP --display headless --button-port $BUTTON_PORT --automation-port $AUTOMATION_PORT --apdu-port $APDU_PORT |& (cat > "$OUTDIR/speculos.log") & SPEC_PID=$!
echo "SPECULOS_PID $SPEC_PID"
sleep 3

"$bats" -p "$TESTS_DIR"/*.bats

kill $SPEC_PID
kill $NODE1_PID
