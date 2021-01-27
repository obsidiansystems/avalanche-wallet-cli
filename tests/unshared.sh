#!/usr/bin/env bash

set -euox pipefail

DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

unshare --map-root-user --net --pid --fork "$BASH" <<EOF
  ip link set dev lo up
  $DIR/network.sh $1
EOF
