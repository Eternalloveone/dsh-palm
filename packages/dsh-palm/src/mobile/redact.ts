/**
 * One redaction pass for everything that leaves the phone.
 *
 * F4 exports are the first feature whose output the user will paste into a
 * ticket, a chat, an email. Session logs routinely contain keys the agent read,
 * an `export TOKEN=…` line, a curl with credentials in the URL, or a private
 * key dump — and "copy to clipboard" has no undo. So redaction is ONE module
 * applied to every export path (Markdown, HTML, clipboard), not a best-effort
 * sprinkle at each call site.
 *
 * It is deliberately conservative: matching shapes are replaced with
 * {@link REDACTED} while the surrounding label stays (`api_key: [已隐藏]`), so
 * the reader can still see that a secret was there. False positives are rare by
 * construction (the shapes below are all key-shaped), and a false positive is a
 * cosmetic loss while a false negative is a leak.
 *
 * @module dsh-palm/mobile/redact
 */

/** Placeholder left in place of a matched secret. */
export const REDACTED = '[已隐藏]'

interface RedactionRule {
  pattern: RegExp
  replacement: string | ((...match: string[]) => string)
}

const RULES: readonly RedactionRule[] = [
  // Private key blocks first: they span lines and would swallow everything else.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY----- ${REDACTED} -----END PRIVATE KEY-----`,
  },
  // Credentials embedded in a URL: scheme://user:pass@host.
  {
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    replacement: `$1${REDACTED}@`,
  },
  // Provider-shaped tokens.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: `sk-${REDACTED}` },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: `gh_${REDACTED}` },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: `github_pat_${REDACTED}` },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: `AKIA${REDACTED}` },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: `xox-${REDACTED}` },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replacement: `AIza${REDACTED}` },
  // JWTs.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: REDACTED },
  // Authorization headers.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `Bearer ${REDACTED}` },
  // key: value / key = value pairs, keeping the label and any surrounding quotes.
  {
    pattern: /(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\b\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}(["']?)/gi,
    replacement: `$1${REDACTED}$2`,
  },
]

/**
 * Replace secret-shaped substrings with {@link REDACTED}.
 * @param text - export text (message body, command line, …).
 * @returns the same text with secrets masked; non-strings return ''.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || text === '') return ''
  let output = text
  for (const rule of RULES) {
    output = output.replace(rule.pattern, rule.replacement as string)
  }
  return output
}

/** Whether a text WOULD be changed — for a UI hint before sharing. */
export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text
}
