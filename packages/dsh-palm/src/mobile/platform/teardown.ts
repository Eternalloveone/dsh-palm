/**
 * Pairing teardown: everything that belongs to one device identity, cleared in
 * one place.
 *
 * "Revoke this device" used to clear only the roster cache, drafts and pins
 * (`clearPairingCaches`); the chat transcript cache kept its own index key and
 * was never registered anywhere, so a revoked phone could still open its PWA
 * offline and read the previous identity's conversations. The same applied to
 * the finished-run ledger, queued-echo copies, the offline outbox and the voice
 * service API keys.
 *
 * Every module that persists identity-scoped data registers its own clear here,
 * and the app calls {@link runPairingTeardown} once when the pairing state goes
 * to `unpaired`. Failures are collected, never thrown: one module failing to
 * clear must not stop the others.
 *
 * @module dsh-palm/mobile/teardown
 */

import { dropAllChatCaches } from '../session/chat-cache.ts'
import { clearFinishedRuns } from '../session/recent-finished.ts'
import { clearQueuedEchoes } from '../session/queued-echo.ts'
import { dropOutbox } from './offline.ts'
import { clearVoiceServices } from './voice-services.ts'
import { clearPairingCaches } from '../session/list-persist.ts'
import { clearHistoryCache } from '../session/history-cache.ts'

/** One teardown step (sync or async). */
export type PairingTeardown = () => void | Promise<void>

/** Extra steps registered by future modules (executed after the built-ins). */
const registered = new Set<PairingTeardown>()

/**
 * Register one teardown step.
 * @param step - runs on every `unpaired` transition.
 * @returns an unregister function (tests use it to stay isolated).
 */
export function onPairingTeardown(step: PairingTeardown): () => void {
  registered.add(step)
  return () => { registered.delete(step) }
}

/** The identity-scoped stores this build knows about, in a stable order. */
const BUILTIN: readonly PairingTeardown[] = [
  // Persisted transcripts first: they are the largest and the most sensitive.
  () => dropAllChatCaches(),
  () => clearHistoryCache(),
  // Local ledgers that quote conversation text.
  () => clearFinishedRuns(),
  () => clearQueuedEchoes(),
  // Outbound work that must not run under the next identity.
  () => dropOutbox(),
  // Credentials the user typed into this phone.
  () => clearVoiceServices(),
  // List/draft/pin/scroll scaffolding.
  () => clearPairingCaches(),
]

/**
 * Clear every identity-scoped store.
 * @returns the steps that failed, for logging (never throws).
 */
export async function runPairingTeardown(): Promise<{ failed: string[] }> {
  const failed: string[] = []
  for (const step of [...BUILTIN, ...registered]) {
    try {
      await step()
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { failed }
}
