// Commit message lint (CI only, via wagoid/commitlint-github-action).
// Conventional Commits for every normal commit; release commits produced
// by the palm-release squash (vX.Y.Z: release dsh-palm) are exempt.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [commit => /^v\d+\.\d+\.\d+/.test(commit)],
  rules: {
    'header-max-length': [2, 'always', 100],
  },
}
