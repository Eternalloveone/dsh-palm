/**
 * Session folders: host-side grouping behind the phone's 筛选 chips.
 *
 * The properties worth pinning: names are normalized/limited, folder ids are
 * the only thing sessions reference (deleting a folder un-files its sessions
 * instead of orphaning them), state survives a restart, and a corrupt file
 * degrades to "no folders" rather than taking the plugin down.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_FOLDER_NAME,
  MAX_FOLDERS,
  SessionFolders,
  normalizeFolderName,
} from './folders.ts'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-folders-'))
  file = join(dir, 'folders.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('normalizeFolderName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeFolderName('  客户   A  ')).toBe('客户 A')
  })

  it('rejects empty and over-long names', () => {
    expect(normalizeFolderName('   ')).toBeUndefined()
    expect(normalizeFolderName('x'.repeat(MAX_FOLDER_NAME + 1))).toBeUndefined()
    expect(normalizeFolderName(42)).toBeUndefined()
  })
})

describe('SessionFolders', () => {
  it('creates folders and refuses duplicates/empty names', () => {
    const folders = new SessionFolders(file)
    const created = folders.create('客户 A')
    expect(created?.name).toBe('客户 A')
    expect(created?.id).toMatch(/^f-[0-9a-f]{8}$/)
    expect(folders.create('客户 A')).toBeUndefined()
    expect(folders.create('   ')).toBeUndefined()
    expect(folders.list().folders).toHaveLength(1)
  })

  it('caps the number of folders', () => {
    const folders = new SessionFolders(file)
    for (let index = 0; index < MAX_FOLDERS; index += 1) {
      expect(folders.create(`分组 ${index}`)).toBeDefined()
    }
    expect(folders.create('再来一个')).toBeUndefined()
  })

  it('renames and refuses a collision with another folder', () => {
    const folders = new SessionFolders(file)
    const a = folders.create('A')
    const b = folders.create('B')
    expect(folders.rename(a!.id, 'B')).toBe(false)
    expect(folders.rename(a!.id, 'A2')).toBe(true)
    expect(folders.list().folders.map(folder => folder.name)).toEqual(['A2', 'B'])
    expect(folders.rename(b!.id, 'B')).toBe(true)
  })

  it('assigns a session, clears it, and refuses unknown folders', () => {
    const folders = new SessionFolders(file)
    const created = folders.create('客户')
    expect(folders.assign('s-1', created!.id)).toBe(true)
    expect(folders.list().assignments).toEqual({ 's-1': created!.id })
    expect(folders.assign('s-1', 'f-unknown')).toBe(false)
    expect(folders.assign('s-1', null)).toBe(true)
    expect(folders.list().assignments).toEqual({})
  })

  it('deleting a folder un-files its sessions instead of orphaning them', () => {
    const folders = new SessionFolders(file)
    const created = folders.create('临时')
    folders.assign('s-1', created!.id)
    folders.assign('s-2', created!.id)
    expect(folders.remove(created!.id)).toBe(true)
    expect(folders.list()).toEqual({ folders: [], assignments: {} })
  })

  it('survives a restart (persisted JSON is read back)', () => {
    const first = new SessionFolders(file)
    const created = first.create('持久')
    first.assign('s-9', created!.id)

    const second = new SessionFolders(file)
    expect(second.list().folders.map(folder => folder.name)).toEqual(['持久'])
    expect(second.list().assignments).toEqual({ 's-9': created!.id })
  })

  it('degrades to no folders on a corrupt file', () => {
    writeFileSync(file, '{not json', 'utf8')
    const folders = new SessionFolders(file)
    expect(folders.list()).toEqual({ folders: [], assignments: {} })
    // And it can heal itself: creating a folder rewrites the file.
    expect(folders.create('新建')).toBeDefined()
    expect(JSON.parse(readFileSync(file, 'utf8')).folders).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('writes the file owner-only', () => {
    const folders = new SessionFolders(file)
    folders.create('私有')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
