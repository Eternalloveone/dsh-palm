// Commit message lint (CI only, via wagoid/commitlint-github-action).
// Conventional Commits for every normal commit; release commits produced
// by the palm-release squash (vX.Y.Z: release dsh-palm) and the adaptation
// work captured in v1.3.0 (adapt: prefix) are exempt.
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    commit => /^v\d+\.\d+\.\d+/.test(commit),
    commit => /^adapt:/.test(commit),
    // v1.3.0 docs commits: uppercase proper-noun subject and one 111-char
    // header predate the lint rules; exempted verbatim, no blanket relaxation.
    commit => /^docs: COMPATIBILITY\.md add runtime-env/.test(commit),
    commit => /^docs: v1\.3\.0 changelog \+ correct READMEs for decoupled naming/.test(commit),
    // 2026-11-17：README 重做那条的 subject 以专有名词 README 开头，被 subject-case
    // 判成 start-case。同样逐条豁免，不放宽全局（改历史要 rebase 466 个提交，不值）。
    commit => /^docs: README 三处改造/.test(commit),
  ],
  rules: {
    // 中文提交下这几条都要放宽：同一个信息量，中文字符数是英文的两三倍。
    // header 100 字符 ≈ 50 汉字（本项目标题常见 60~80 汉字，必然超）；
    // body 里贴一段实测结论就超 100/200。保留"别写成一整行"的意图，按中文给余量。
    'header-max-length': [2, 'always', 150],
    'body-max-line-length': [0],
    // subject-case 对中文完全不可靠：中文没有大小写，纯中文 subject 也会被判成
    // start-case/sentence-case（466 个历史提交里 100+ 条命中，而 CI 只 lint
    // push 范围所以从没红过）。逐条豁免不现实，关掉。
    'subject-case': [0],
    // type 枚举补上历史用过的两个非 conventional 词，避免 3 条老提交永远红。
    'type-enum': [2, 'always', [
      'build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'polish', 'preview',
      'refactor', 'revert', 'style', 'test',
    ]],
  },
}
