import { createHash } from "node:crypto"

// Gravatar pictures by email. The hash goes only from the server to
// Gravatar, never into a page, so members' emails cannot be matched against
// it. Never touches the database; the avatar actions store what it returns.

/** The member's Gravatar as image bytes, or null when they have none. */
export async function gravatarImage(email: string) {
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
  const response = await fetch(
    `https://gravatar.com/avatar/${hash}?s=256&d=404`,
    { cache: "no-store", signal: AbortSignal.timeout(5000) }
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Gravatar ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
