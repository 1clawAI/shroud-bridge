#!/usr/bin/env bash
# Delegates to repo-root scripts/test-shroud-bridge-models.sh
exec "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/test-shroud-bridge-models.sh" "$@"
