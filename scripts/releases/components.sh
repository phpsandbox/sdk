#!/usr/bin/env bash
# Repository release recipes. CWD is an isolated checkout or verified artifact.
set -euo pipefail
component="${1:?component}"
phase="${2:?phase}"

require_env() {
  local name
  for name in "$@"; do
    if [[ -z "${!name-}" ]]; then
      echo "Missing required environment variable: $name" >&2
      exit 1
    fi
  done
}

node_major() {
  local expected="$1"
  if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$expected" ]]; then
    echo "This component requires Node $expected (matching its workflow)." >&2
    exit 1
  fi
}

case "$component:$phase" in
  sdk:prepare)
    node_major 24
    [[ "$(npm --version)" == 11.* ]]
    npm ci
    npm run build
    npm pack --ignore-scripts --pack-destination "$RELEASE_OUTPUT"
    ;;
  sdk:apply)
    require_env RELEASE_NPM_TAG
    node_major 24
    npm whoami --registry=https://registry.npmjs.org/ > /dev/null
    # Publish the checked tarball, not a fresh build. npm handles OTP interactively.
    npm publish "$RELEASE_PACKAGE" --tag "$RELEASE_NPM_TAG" --access public --registry=https://registry.npmjs.org/ --ignore-scripts
    ;;
  *) echo "Unsupported release component or phase: $component:$phase" >&2; exit 1 ;;
esac
