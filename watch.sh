set -euo pipefail

DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

nix-shell default.nix -A shells.test --run "watch -n 1 yarn run eslint $DIR"
