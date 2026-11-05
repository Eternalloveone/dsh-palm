/**
 * Public handles for paired devices.
 *
 * A device id IS the session credential: `pairing.ts` stores it as the cookie
 * value, and its own `DeviceSnapshot.id` doc says so. Handing that value to
 * every paired phone (the roster used to do exactly that) means one compromised
 * device can impersonate all the others, and "revoke this device" only deletes a
 * server-side row — the revoked party keeps whatever credentials it already
 * read. The phone roster therefore exposes a derived handle, and the admin
 * methods accept that handle and resolve it back here.
 *
 * A handle is `sha256(id)` base64url-truncated to 12 characters. It is stable
 * for one id (no storage, no migration), useless as a cookie, and collisions
 * inside a single device table (max 64 entries) are negligible.
 */

import { createHash } from 'node:crypto'

/** Handle length in characters (72 bits of the digest). */
export const DEVICE_HANDLE_LENGTH = 12

/**
 * Derive the public handle of one device id.
 * @param deviceId - the pairing session id (also the cookie value; never sent to the phone).
 * @returns a stable, credential-free handle.
 */
export function deviceHandleOf(deviceId: string): string {
  return createHash('sha256').update(deviceId, 'utf8').digest('base64url').slice(0, DEVICE_HANDLE_LENGTH)
}

/**
 * Resolve a handle back to the device id inside one device table.
 * @param devices - the current device rows (order does not matter).
 * @param handle - a handle previously produced by {@link deviceHandleOf}.
 * @returns the matching device id, or undefined when the handle is unknown.
 */
export function resolveDeviceHandle(
  devices: Iterable<{ id: string }>,
  handle: string,
): string | undefined {
  if (typeof handle !== 'string' || handle === '') return undefined
  for (const device of devices) {
    if (deviceHandleOf(device.id) === handle) return device.id
  }
  return undefined
}
