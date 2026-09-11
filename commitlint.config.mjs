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
    commit => /^docs: COMPATIBILITY\.md add runtime-env and plugin\/component dependency sections$/.test(commit),
    commit => /^docs: v1\.3\.0 changelog \+ correct READMEs for decoupled naming/.test(commit),
  ],
  rules: {
    'header-max-length': [2, 'always', 100],
  },
}
