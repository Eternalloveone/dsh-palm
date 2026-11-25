/**
 * Refuses to publish from a workstation.
 *
 * The green "Provenance" badge on the npmjs page is the SLSA attestation that
 * `pnpm publish --provenance` mints inside GitHub Actions, where an OIDC
 * identity exists. A publish from a local shell has no such identity, gets no
 * attestation, and npm cannot add one afterwards — that version keeps the
 * missing badge forever (2.0.0 on 2026-11-17, and 1.2.0 / 1.3.1 before it).
 *
 * The only sanctioned release path is a tag push: the publish workflow builds,
 * runs the quality gate and publishes with provenance. This hook makes the
 * mistake impossible instead of merely visible.
 *
 * Emergency escape hatch — the version will ship without a provenance badge,
 * so say so in the release notes:
 *
 *   PALM_ALLOW_LOCAL_PUBLISH=1 npm publish
 */
const inActions = process.env.GITHUB_ACTIONS === 'true'
const override = process.env.PALM_ALLOW_LOCAL_PUBLISH === '1'

if (inActions) process.exit(0)

if (override) {
  process.stderr.write('[publish-guard] PALM_ALLOW_LOCAL_PUBLISH=1: publishing from this machine anyway.\n')
  process.stderr.write('[publish-guard] This version ships WITHOUT a provenance attestation — the npm page gets no green badge.\n')
  process.exit(0)
}

process.stderr.write('[publish-guard] Refusing to publish from this machine.\n')
process.stderr.write('\n')
process.stderr.write('A local publish produces no provenance attestation, and npm cannot mint one afterwards:\n')
process.stderr.write('that version would permanently lose its green badge on the npm page.\n')
process.stderr.write('\n')
process.stderr.write('Publish through the workflow instead:\n')
process.stderr.write('  git push origin main --follow-tags\n')
process.stderr.write('    -> the publish workflow builds, gates and publishes with --provenance\n')
process.stderr.write('\n')
process.stderr.write('Emergency only (badge lost for that version): PALM_ALLOW_LOCAL_PUBLISH=1 npm publish\n')
process.exit(1)
