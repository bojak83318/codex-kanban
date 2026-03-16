#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/home/rocm/clawcontrol/.local/bin:${PATH}"

cd "${ROOT_DIR}"
exec npm test
