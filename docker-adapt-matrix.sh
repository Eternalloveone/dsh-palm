#!/usr/bin/env bash
# 逐个边界版本跑体检（容器内）。
set -uo pipefail
for v in 0.2.1-rc.2 0.2.1-alpha.1 0.2.0-rc.1 0.1.7-rc.2; do
  echo "##### $v #####"
  bash /repo/docker-adapt-check.sh "$v" 2>&1 | grep -E 'TSC_EXIT|error TS|TYPECHECK_|Tests +[0-9]|TESTS_|INSTALL_FAILED' | head -6
done
