import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWritableDirectory } from '../scripts/windows-write-preflight.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Windows write preflight', () => {
  it('creates and probes a missing output directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-palm-preflight-'))
    temporaryDirectories.push(root)
    const output = join(root, 'nested', 'output')

    await ensureWritableDirectory(output)
    await writeFile(join(output, 'artifact.js'), 'ok')

    await expect(readFile(join(output, 'artifact.js'), 'utf8')).resolves.toBe('ok')
  })

  it.skipIf(process.platform !== 'win32')('clears the read-only bit before probing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-palm-preflight-'))
    temporaryDirectories.push(root)
    const output = join(root, 'output')
    await ensureWritableDirectory(output)
    const artifact = join(output, 'artifact.js')
    await writeFile(artifact, 'old')
    await chmod(artifact, 0o444)

    await ensureWritableDirectory(output)
    await writeFile(artifact, 'new')

    await expect(readFile(artifact, 'utf8')).resolves.toBe('new')
  })
})
