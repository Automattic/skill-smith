#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix testing-project
