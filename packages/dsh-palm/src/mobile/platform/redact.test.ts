import { describe, expect, it } from 'vitest'
import { REDACTED, containsSecret, redactSecrets } from './redact.ts'

describe('redactSecrets', () => {
  it('masks provider-shaped tokens but keeps the prefix', () => {
    expect(redactSecrets('key=sk-abcdefghijklmnop1234')).toBe(`key=sk-${REDACTED}`) //gitleaks:allow
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwx')).toBe(`token gh_${REDACTED}`) //gitleaks:allow
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toBe(`AKIA${REDACTED}`) //gitleaks:allow
    expect(redactSecrets('xoxb-1234567890-abcdefghij')).toBe(`xox-${REDACTED}`) //gitleaks:allow
  })

  it('masks Bearer headers and key=value pairs, keeping the label', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toBe(`Authorization: Bearer ${REDACTED}`)
    // Quotes survive so the surrounding config line stays syntactically valid.
    expect(redactSecrets('api_key = "supersecretvalue"')).toBe(`api_key = "${REDACTED}"`)
    expect(redactSecrets('PASSWORD: hunter2hunter2')).toBe(`PASSWORD: ${REDACTED}`)
  })

  it('masks credentials inside URLs', () => {
    expect(redactSecrets('https://user:pass@example.com/repo.git'))
      .toBe(`https://${REDACTED}@example.com/repo.git`)
  })

  it('masks JWTs and private key blocks', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signaturepart' //gitleaks:allow
    expect(redactSecrets(`token ${jwt}`)).toBe(`token ${REDACTED}`)
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----' //gitleaks:allow
    expect(redactSecrets(pem)).toContain(REDACTED)
    expect(redactSecrets(pem)).not.toContain('MIIEow')
  })

  it('leaves ordinary text alone', () => {
    const text = '修复了 bash 审批里 pnpm build 被截断的问题，见 src/mobile/sheets.tsx:480。'
    expect(redactSecrets(text)).toBe(text)
    expect(containsSecret(text)).toBe(false)
  })

  it('does not treat every long identifier as a secret', () => {
    expect(redactSecrets('sessionId=s-0123456789abcdef0123456789abcdef')).toBe('sessionId=s-0123456789abcdef0123456789abcdef')
    expect(redactSecrets('commit 45fd95a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7')).toContain('45fd95a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7')
  })
})
