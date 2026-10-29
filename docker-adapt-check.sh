#!/usr/bin/env bash
# 在容器里评估 dsh-palm 与 DSH SDK 的兼容性（安装 / typecheck / 单测）。
# 用法：bash docker-adapt-check.sh [目标版本]   （不给就用每包最高发布版）
set -uo pipefail
. /repo/docker-adapt-lib.sh

TARGET="${1:-}"
WORK=/w
copy_sources "$WORK"
cd "$WORK"

echo "=== 目标：${TARGET:-(每包最高发布版)} ==="
TARGET="$TARGET" node -e '
const fs = require("fs");
const target = process.env.TARGET || "";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const names = new Set();
for (const name of Object.keys(pkg.devDependencies ?? {})) {
  if (name.startsWith("@deepseek-ai/dsh-")) names.add(name);
}
const parse = (v) => { const [core, pre] = v.split("-"); return { nums: core.split(".").map(Number), pre: pre ?? "" }; };
const cmp = (a, b) => {
  const A = parse(a); const B = parse(b);
  for (let i = 0; i < 3; i += 1) if ((A.nums[i] ?? 0) !== (B.nums[i] ?? 0)) return (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
  if (A.pre === B.pre) return 0;
  if (A.pre === "") return 1;
  if (B.pre === "") return -1;
  return A.pre < B.pre ? -1 : 1;
};
(async () => {
  const rows = [];
  for (const name of names) {
    const res = await fetch("https://registry.npmjs.org/" + name.replace("/", "%2f"));
    if (!res.ok) { rows.push([name, "MISSING", "missing"]); continue; }
    const versions = Object.keys((await res.json()).versions ?? {});
    const picked = versions.includes(target) ? target : versions.sort(cmp).pop();
    rows.push([name, picked, versions.includes(target) ? "精确" : (target === "" ? "最高" : "退到最高")]);
    pkg.devDependencies[name] = picked;
  }
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  for (const [name, picked, note] of rows) console.log("  " + name.padEnd(46) + String(picked).padEnd(18) + note);
})();
'

echo "=== npm install ==="
if ! npm install --no-audit --no-fund --legacy-peer-deps >/tmp/adapt-install.log 2>&1; then
  echo "INSTALL_FAILED"
  grep -E 'notarget|ETARGET|E404|404 Not Found|ERESOLVE' /tmp/adapt-install.log | head -10
  exit 2
fi
echo "install ok"

echo "=== typecheck ==="
npx tsc -p tsconfig.json --noEmit --composite false >/tmp/adapt-tsc.log 2>&1
TSC_EXIT=$?
echo "TSC_EXIT=$TSC_EXIT errors=$(grep -c 'error TS' /tmp/adapt-tsc.log)"
grep 'error TS' /tmp/adapt-tsc.log | head -30

echo "=== 单测 ==="
npx vitest run >/tmp/adapt-vitest.log 2>&1
VITEST_EXIT=$?
echo "VITEST_EXIT=$VITEST_EXIT"
grep -E 'Test Files|Tests +[0-9]' /tmp/adapt-vitest.log | head -3
# vitest 的输出带 ANSI 颜色，先剥掉再找失败用例名
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/adapt-vitest.log > /tmp/adapt-vitest.plain.log
grep -E '× |FAIL ' /tmp/adapt-vitest.plain.log | head -20
echo "--- vitest tail ---"
tail -12 /tmp/adapt-vitest.plain.log

echo "=== 结论 ==="
[ $TSC_EXIT -eq 0 ] && echo "TYPECHECK_PASS" || echo "TYPECHECK_FAIL"
[ $VITEST_EXIT -eq 0 ] && echo "TESTS_PASS" || echo "TESTS_FAIL"
