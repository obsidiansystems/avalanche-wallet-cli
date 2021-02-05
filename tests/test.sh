set -euo pipefail

TEST_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

export CLI=${CLI:-avalanche-ledger-cli}
export FAUCET=${FAUCET:-avalanche-ledger-faucet}

XARGS="${XARGS:-xargs -n1}"

find "$TEST_DIR" -type f -name '*.bats' | $XARGS "$TEST_DIR/unshared.sh"
