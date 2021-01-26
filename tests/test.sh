set -euo pipefail

DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && cd .. && pwd )

export CLI="$DIR/cli/cli.js"
export FAUCET="$DIR/cli/faucet.js"

yarn run eslint $CLI

TEST_DIR=$DIR/tests

parallel --will-cite --timeout 600 "$TEST_DIR/unshared.sh" ::: \
  "$TEST_DIR/atomic-swap.bats" \
  "$TEST_DIR/basic-tests.bats" \
  "$TEST_DIR/atomic-swap-cchain.bats" \
  "$TEST_DIR/staking.bats"
