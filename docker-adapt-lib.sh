#!/usr/bin/env bash
# 容器内：把 dsh-palm 源码拷出来（**排除 node_modules** —— pnpm 的符号链接是绝对路径，
# 拷进容器会指向不存在的 /node_modules/.pnpm/...，导致 vitest 跑不起来）。
set -uo pipefail

copy_sources() {
  local dest="$1"
  rm -rf "$dest" && mkdir -p "$dest"
  # 保留 lib/：mobile-routes 等用例要读**已构建**的 bundle 与分片，排除它会变成假失败。
  tar -C /repo/packages/dsh-palm --exclude=node_modules --exclude=.turbo --exclude=.vitest-cache -cf - . | tar -C "$dest" -xf -
}
