// Commit message lint (CI only, via wagoid/commitlint-github-action).
// Conventional Commits for every normal commit; release commits produced
// by the palm-release squash (vX.Y.Z: release dsh-palm) and the adaptation
// work captured in v1.3.0 (adapt: prefix) are exempt.
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [commit => /^v\d+\.\d+\.\d+/.test(commit) || /^adapt:/.test(commit)],
  rules: {
    'header-max-length': [2, 'always', 100],
  },
}
