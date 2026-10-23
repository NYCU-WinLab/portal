// The Google token /groups works with: the portal-groups service account's
// key (GOOGLE_GROUPS_SA_KEY, its JSON key as base64) signs a JWT that
// Google's token endpoint swaps for an access token, scoped to group
// membership. The account holds only GROUPS_RETRIEVE and GROUPS_UPDATE.
import { createSign } from "node:crypto"

import { GroupsCredentialError, type GroupsApi } from "@/lib/groups/google"
import { BATCH_BUDGET_MS } from "@/lib/groups/membership"
import { SCOPES } from "@/lib/groups/scopes"

type Key = { client_email: string; private_key: string; token_uri?: string }

let cached: { token: string; expires: number } | null = null

function readKey(): Key | null {
  const raw = process.env.GOOGLE_GROUPS_SA_KEY?.trim()
  if (!raw) return null
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Key
  } catch {
    console.error("[groups] GOOGLE_GROUPS_SA_KEY is not base64 JSON")
    return null
  }
}

async function accessToken(key: Key) {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: key.client_email,
    scope: SCOPES.join(" "),
    aud: key.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key.private_key, "base64url")
  const response = await fetch(
    key.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!response.ok) {
    cached = null
    throw new Error(`Google token ${response.status}`)
  }
  const body = (await response.json()) as {
    access_token: string
    expires_in: number
  }
  cached = {
    token: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
  }
  return cached.token
}

/** The Directory API client for one request, or null when not set up. */
export function groupsApiFromEnv(): GroupsApi | null {
  const key = readKey()
  const domain = process.env.GOOGLE_GROUPS_DOMAIN?.trim().toLowerCase()
  if (!key || !domain) return null
  return {
    fetch,
    domain,
    deadline: Date.now() + BATCH_BUDGET_MS,
    token: async () => {
      try {
        return await accessToken(key)
      } catch (error) {
        throw new GroupsCredentialError(
          "無法取得 Google 權杖，請通知 portal 管理員",
          error instanceof Error ? error.message : String(error)
        )
      }
    },
  }
}
