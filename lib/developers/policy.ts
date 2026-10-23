import { z } from "zod"

export const SCOPES = {
  profile: {
    label: "帳號與 Email",
    restricted: false,
    description: "取得你的帳號名稱與電子郵件。",
  },
  name: { label: "姓名", restricted: true, description: "取得你的姓名。" },
  groups: {
    label: "實驗室群組",
    restricted: true,
    description: "取得你的屆別、成員身分與專案群組名稱。",
  },
} as const
export type Scope = keyof typeof SCOPES
export const scopeSchema = z.enum(["profile", "name", "groups"])

export function approvedScopes(
  requested: string[],
  allowed: string[]
): Scope[] | false {
  if (
    !requested.length ||
    requested.some((s) => !Object.hasOwn(SCOPES, s) || !allowed.includes(s))
  )
    return false
  return [...new Set(requested)] as Scope[]
}

export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      !value.includes("*") &&
      !url.hash &&
      !value.includes("#") &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
  } catch {
    return false
  }
}

export const applicationInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2000),
  contact_email: z.email().max(254),
  privacy_url: z
    .url()
    .max(2048)
    .refine(
      (v) => v.startsWith("https://") && validRedirect(v),
      "隱私政策需使用 HTTPS"
    ),
  client_type: z.enum(["public", "confidential"]),
  redirect_uris: z
    .array(
      z
        .string()
        .max(2048)
        .refine(
          validRedirect,
          "回呼網址需使用 HTTPS；本機開發可使用 HTTP localhost，不可包含萬用字元或 fragment"
        )
    )
    .min(1)
    .max(10),
})
export const authorizeInput = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().max(2048).refine(validRedirect),
  response_type: z.literal("code"),
  scope: z.string().min(1).max(100),
  state: z.string().min(1).max(1024),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
})
export type AuthorizationInput = z.infer<typeof authorizeInput>

export function memberGroups(
  groups: { name: string; path: string }[]
): string[] {
  return [
    ...new Set(
      groups
        .filter((g) => /^\/(lab-member|winlab-projects)\/[^/]+$/.test(g.path))
        .map((g) => g.name)
    ),
  ]
}

export function profileResponse(member: {
  username?: string
  email?: string
  [key: string]: unknown
}) {
  return { username: member.username ?? null, email: member.email ?? null }
}
