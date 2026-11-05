/**
 * Phone-side session folders.
 *
 * Sessions on the phone used to be one flat, auto-chunked list (active / code /
 * other): there was no way to put "the three I actually care about" anywhere,
 * and nothing to filter by except search. Folders live HOST-side (not in
 * localStorage) for two reasons: the desktop panel and every paired phone see
 * the same grouping, and a phone's local storage is wiped on revoke — the
 * user's organisation must survive that.
 *
 * The store is one small JSON file next to the device table, owner-only
 * (`0600`) and atomically replaced, same stance as `pairing.ts` /
 * `notify-store.ts`. A corrupt file degrades to "no folders" instead of
 * crashing the plugin: grouping is a convenience, never a boot dependency.
 *
 * @module dsh-palm/folders
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** One folder. */
export interface SessionFolder {
  /** Stable id (`f-<8 hex>`); never reused. */
  id: string
  /** Display name (trimmed, ≤ {@link MAX_FOLDER_NAME}). */
  name: string
  /** Creation time (epoch ms) — ordering key. */
  createdAt: number
}

/** The whole grouping state: folders + session→folder assignments. */
export interface FolderSnapshot {
  folders: SessionFolder[]
  /** sessionId → folderId. A missing key means "no folder". */
  assignments: Record<string, string>
}

/** Hard cap on folders (a phone UI cannot present more). */
export const MAX_FOLDERS = 32
/** Hard cap on folder name length (CJK-safe; the chip row truncates further). */
export const MAX_FOLDER_NAME = 24
/** Hard cap on assignments (stale session ids are pruned on assignment churn). */
export const MAX_ASSIGNMENTS = 500
/** File name inside DSH_HOME. */
export const FOLDERS_FILE = 'dsh-palm-folders.json'

/**
 * The default folders file.
 * @param home - DSH home (test seam).
 * @returns absolute path of the folder store.
 */
export function defaultFoldersFile(home: string = dshHome()): string {
  return join(home, FOLDERS_FILE)
}

/** Normalize a user-supplied folder name; undefined when unusable. */
export function normalizeFolderName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '' || name.length > MAX_FOLDER_NAME) return undefined
  return name
}

/** The host-side folder store (one instance per plugin lifetime). */
export class SessionFolders {
  private data: FolderSnapshot = { folders: [], assignments: {} }
  private readonly file: string

  /**
   * @param file - where the JSON lives (test seam; production uses {@link defaultFoldersFile}).
   */
  constructor(file: string = defaultFoldersFile()) {
    this.file = file
    this.load()
  }

  /** Current grouping (defensive copy; callers may serialize it). */
  list(): FolderSnapshot {
    return {
      folders: this.data.folders.map(folder => ({ ...folder })),
      assignments: { ...this.data.assignments },
    }
  }

  /**
   * Create one folder.
   * @param rawName - user input (trimmed/normalized).
   * @returns the new folder, or undefined when the name is unusable/duplicate/cap reached.
   */
  create(rawName: unknown): SessionFolder | undefined {
    const name = normalizeFolderName(rawName)
    if (name === undefined) return undefined
    if (this.data.folders.length >= MAX_FOLDERS) return undefined
    if (this.data.folders.some(folder => folder.name === name)) return undefined
    const folder: SessionFolder = {
      id: `f-${randomBytes(4).toString('hex')}`,
      name,
      createdAt: Date.now(),
    }
    this.data.folders.push(folder)
    this.persist()
    return { ...folder }
  }

  /**
   * Rename one folder (collision with another name is refused).
   * @param id - folder id.
   * @param rawName - new name.
   * @returns true when persisted.
   */
  rename(id: string, rawName: unknown): boolean {
    const name = normalizeFolderName(rawName)
    if (name === undefined) return false
    const folder = this.data.folders.find(entry => entry.id === id)
    if (folder === undefined) return false
    if (this.data.folders.some(entry => entry.id !== id && entry.name === name)) return false
    folder.name = name
    this.persist()
    return true
  }

  /**
   * Delete one folder and move its sessions back to "no folder".
   * @param id - folder id.
   * @returns true when something was removed.
   */
  remove(id: string): boolean {
    const before = this.data.folders.length
    this.data.folders = this.data.folders.filter(folder => folder.id !== id)
    if (this.data.folders.length === before) return false
    for (const [sessionId, folderId] of Object.entries(this.data.assignments)) {
      if (folderId === id) delete this.data.assignments[sessionId]
    }
    this.persist()
    return true
  }

  /**
   * Assign a session to a folder (or clear it with `null`).
   * @param sessionId - host session id.
   * @param folderId - target folder, or null to unfile.
   * @returns true when accepted (unknown folder ids are refused).
   */
  assign(sessionId: string, folderId: string | null): boolean {
    if (typeof sessionId !== 'string' || sessionId === '') return false
    if (folderId === null) {
      if (this.data.assignments[sessionId] === undefined) return true
      delete this.data.assignments[sessionId]
      this.persist()
      return true
    }
    if (!this.data.folders.some(folder => folder.id === folderId)) return false
    if (this.data.assignments[sessionId] === folderId) return true
    if (Object.keys(this.data.assignments).length >= MAX_ASSIGNMENTS
      && this.data.assignments[sessionId] === undefined) {
      return false
    }
    this.data.assignments[sessionId] = folderId
    this.persist()
    return true
  }

  /** Read the file, tolerating anything that is not a valid snapshot. */
  private load(): void {
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return
      const value = parsed as { folders?: unknown; assignments?: unknown }
      const folders: SessionFolder[] = []
      if (Array.isArray(value.folders)) {
        for (const entry of value.folders) {
          if (typeof entry !== 'object' || entry === null) continue
          const row = entry as Record<string, unknown>
          if (typeof row.id !== 'string' || row.id === '') continue
          const name = normalizeFolderName(row.name)
          if (name === undefined) continue
          folders.push({ id: row.id, name, createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0 })
        }
      }
      const known = new Set(folders.map(folder => folder.id))
      const assignments: Record<string, string> = {}
      if (typeof value.assignments === 'object' && value.assignments !== null) {
        for (const [sessionId, folderId] of Object.entries(value.assignments as Record<string, unknown>)) {
          if (typeof folderId === 'string' && known.has(folderId)) assignments[sessionId] = folderId
        }
      }
      this.data = { folders, assignments }
    } catch {
      // Corrupt file: grouping is a convenience, not a boot dependency.
      console.warn('dsh-palm: ignoring unreadable folders file', this.file)
    }
  }

  /** Persist atomically with owner-only permissions. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const body = JSON.stringify(this.data, null, 2)
      const temp = `${this.file}.${process.pid}.${Date.now().toString(36)}.tmp`
      writeFileSync(temp, body, { mode: 0o600 })
      renameSync(temp, this.file)
    } catch (error) {
      console.warn('dsh-palm: failed to persist session folders', error)
    }
  }
}
