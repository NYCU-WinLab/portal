// Mailing-list addresses as the /groups UI accepts them. Google compares
// addresses case-insensitively, so everything is lower-cased here once and
// every comparison downstream can be a plain string match.

/** Same bound as group_membership_audit.member_email. */
export const MAX_EMAIL_LENGTH = 320

// \p{Cc} and \p{Cs} keep control characters and lone surrogates out:
// Postgres can't store U+0000 or an unpaired surrogate, and one such address
// in an audit insert would sink the whole batch's rows.
const EMAIL =
  /^[^\s\p{Cc}\p{Cs}@<>()",;]+@[^\s\p{Cc}\p{Cs}@<>()",;]+\.[^\s\p{Cc}\p{Cs}@<>()",;]+$/u

export function normalizeEmail(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  if (text.length > MAX_EMAIL_LENGTH) return null
  return EMAIL.test(text) ? text : null
}

/** Free-text box → addresses. Order kept, duplicates dropped. */
export function parseEmailList(text: string): {
  valid: string[]
  invalid: string[]
} {
  const valid: string[] = []
  const invalid: string[] = []
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue
    const email = normalizeEmail(token)
    if (email === null) invalid.push(token)
    else if (!valid.includes(email)) valid.push(email)
  }
  return { valid, invalid }
}

const GMAIL_HOSTS = new Set(["gmail.com", "googlemail.com"])

/**
 * Whether two normalised addresses are one mailbox as Google lists it. Equal
 * strings always are. Gmail ignores dots in the local part, and only Gmail:
 * on any other domain `a.b@` and `ab@` are different people.
 */
export function sameMailbox(a: string, b: string): boolean {
  if (a === b) return true
  const at = a.lastIndexOf("@")
  const bt = b.lastIndexOf("@")
  if (at <= 0 || bt <= 0) return false
  const hostA = a.slice(at + 1)
  const hostB = b.slice(bt + 1)
  if (!GMAIL_HOSTS.has(hostA) || !GMAIL_HOSTS.has(hostB)) return false
  const dotless = (s: string) => s.replaceAll(".", "")
  return dotless(a.slice(0, at)) === dotless(b.slice(0, bt))
}
