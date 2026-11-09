#!/usr/bin/env bash
set -euo pipefail
cd /workspace/thrift-log
npm ci --cache /workspace/.cache/npm --no-fund --no-audit
npm run typecheck
npm run lint
npm test
npm run build
