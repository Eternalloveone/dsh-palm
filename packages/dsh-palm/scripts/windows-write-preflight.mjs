import { chmod, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Clear the DOS read-only bit where Node exposes it as a writable mode and
 * verify that the current process can create a file in the directory.
 * Existing files are never removed or replaced by this preflight.
 */
export async function ensureWritableDirectory(directory) {
  await mkdir(directory, { recursive: true })
  await makeTreeWritable(directory)

  const probe = join(directory, `.dsh-palm-write-probe-${process.pid}-${Date.now()}`)
  let handle
  try {
    handle = await open(probe, 'wx')
  } catch (error) {
    throw new Error(formatWriteFailure(directory, error))
  } finally {
    await handle?.close().catch(() => {})
  }

  try {
    await unlink(probe)
  } catch (error) {
    throw new Error(formatWriteFailure(directory, error))
  }
}

async function makeTreeWritable(directory) {
  if (process.platform !== 'win32') return
  try {
    await chmod(directory, 0o777)
  } catch {
    // ACLs can reject chmod on Windows; the probe below reports the real issue.
  }
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await makeTreeWritable(path)
    else if (entry.isFile()) {
      try { await chmod(path, 0o666) } catch { /* probe gives the actionable error */ }
    }
  }
}

function formatWriteFailure(directory, error) {
  const code = error && typeof error === 'object' && 'code' in error ? ` (${error.code})` : ''
  return [
    `dsh-palm cannot write ${directory}${code}.`,
    'Close running dsh/node/vitest processes and clear the read-only bit or grant the current Windows user Modify permission.',
    'If antivirus is locking generated files, exclude this repository or retry after the scan completes.',
  ].join(' ')
}

export async function runWritePreflight(kind) {
  const cacheDirectory = resolve(packageDir, '.vitest-cache')
  await ensureWritableDirectory(cacheDirectory)
  if (kind === 'build') {
    const outputDirectory = resolve(packageDir, 'lib')
    await ensureWritableDirectory(outputDirectory)
    await probeExistingFiles(outputDirectory)
  }
}

async function probeExistingFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    throw new Error(formatWriteFailure(directory, error))
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await probeExistingFiles(path)
    else if (entry.isFile()) await probeExistingFile(path)
  }
}

async function probeExistingFile(path) {
  let handle
  try {
    handle = await open(path, 'r+')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new Error(formatWriteFailure(path, error))
  } finally {
    await handle?.close().catch(() => {})
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kind = process.argv[2] ?? 'check'
  await runWritePreflight(kind)
}
