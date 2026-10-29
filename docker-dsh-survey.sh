#!/usr/bin/env bash
# 调查 DSH 各 SDK 包的真实发布情况（dist-tags 不可靠：很多包的 next 还停在 0.0.1-rc.1）。
set -uo pipefail
node -e '
const names = [
  "@deepseek-ai/dsh", "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-host-webserver", "@deepseek-ai/dsh-subagent",
  "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-settings-controller",
  "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-user-questions", "@deepseek-ai/dsh-user-approval",
  "@deepseek-ai/dsh-type-meta", "@deepseek-ai/dsh-agent-presets",
];
const cmp = (a, b) => {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
(async () => {
  for (const name of names) {
    const res = await fetch("https://registry.npmjs.org/" + name.replace("/", "%2f"));
    if (!res.ok) { console.log(name.padEnd(46) + " 未发布（" + res.status + "）"); continue; }
    const body = await res.json();
    const versions = Object.keys(body.versions ?? {});
    const stable = versions.filter(v => !v.includes("-")).sort(cmp).pop();
    const pre = versions.filter(v => v.includes("-")).sort(cmp).pop();
    const tags = Object.entries(body["dist-tags"] ?? {}).map(([k, v]) => k + "=" + v).join(" ");
    console.log(name.padEnd(46) + " 稳定=" + String(stable ?? "-").padEnd(14) + " 最高预发=" + String(pre ?? "-").padEnd(16) + " tags: " + tags);
  }
})();
'
