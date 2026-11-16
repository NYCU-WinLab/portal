import { createHash } from "node:crypto"

// SSH public keys as a member pastes them, or as a Git host serves them at
// /<username>.keys. Only the key type and its base64 blob are kept: a
// pasted comment becomes the label, and anything before the type (the
// options an authorized_keys line may carry) makes the line no key at all,
// so nothing a member types reaches a machine's authorized_keys but a key.

export const keyTypes = [
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
] as const

export type ParsedKey = {
  type: string
  blob: string
  /** As `ssh-keygen -lf` prints it: SHA256: and unpadded base64. */
  fingerprint: string
  /** What followed the key on its line, if anything. */
  comment: string
}

/** One public key line, or null when it is not one. */
export function parsePublicKey(line: string): ParsedKey | null {
  const [type, blob, ...rest] = line.trim().split(/\s+/)
  if (!(keyTypes as readonly string[]).includes(type)) return null
  if (!blob || !/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) return null
  const bytes = Buffer.from(blob, "base64")
  // The blob opens with its own type as a length-prefixed string; a blob
  // that names another type is not this key.
  if (bytes.length < 4) return null
  const named = bytes.subarray(4, 4 + bytes.readUInt32BE(0)).toString("latin1")
  if (named !== type) return null
  return {
    type,
    blob: bytes.toString("base64"),
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    comment: rest.join(" "),
  }
}

/** The hosts a member may import their keys from. Fixed here, so the
 * portal never fetches an address a member chose. */
export const keyHosts = {
  github: { label: "GitHub", origin: "https://github.com" },
  gitlab: { label: "GitLab", origin: "https://gitlab.com" },
  "winlab-gitlab": {
    label: "WinLab GitLab",
    origin: "https://gitlab.winlab.tw",
  },
} as const

export type KeyHost = keyof typeof keyHosts
export const keyHostIds = Object.keys(keyHosts) as [KeyHost, ...KeyHost[]]

export const hostUsername = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

const MAX_HOSTED_BYTES = 64 * 1024

/** The public keys a host lists for one of its accounts. */
export async function hostedKeys(
  host: KeyHost,
  username: string
): Promise<ParsedKey[]> {
  const { label, origin } = keyHosts[host]
  const response = await fetch(
    `${origin}/${encodeURIComponent(username)}.keys`,
    {
      // A private GitLab account answers with a redirect to its sign-in
      // page: that is no key list.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  ).catch(() => null)
  if (response?.status === 404)
    throw new Error(`${label} 沒有 ${username} 這個帳號`)
  if (!response?.ok) throw new Error(`讀不到 ${label} 的公鑰`)
  const text = (await response.text()).slice(0, MAX_HOSTED_BYTES)
  return text
    .split("\n")
    .map(parsePublicKey)
    .filter((key): key is ParsedKey => key !== null)
}
