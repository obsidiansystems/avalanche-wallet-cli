set -euo pipefail

DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

unshare --map-root-user --net --pid --fork <<EOF
  ip link set dev lo up
  $DIR/network.sh $1
EOF
