export type Application = {
  id: string
  owner_id: string
  name: string
  description: string
  contact_email: string
  privacy_url: string
  client_type: "public" | "confidential"
  redirect_uris: string[]
  approved_scopes: string[]
  enabled: boolean
  secret_hash: string | null
  created_at: string
}
export type Grant = {
  id: string
  app_id: string
  user_id: string
  scopes: string[]
  created_at: string
  expires_at: string
}
export type Code = {
  hash: string
  grant_id: string
  scopes: string[]
  redirect_uri: string
  challenge: string
  expires_at: string
}
export type TokenPair = {
  access_hash: string
  refresh_hash: string
  refresh_used: boolean
  grant_id: string
  scopes: string[]
  access_expires_at: string
  refresh_expires_at: string
}
export type ScopeRequest = {
  id: string
  app_id: string
  scopes: string[]
  purpose: string
  status: "pending" | "approved" | "rejected"
  review_note: string | null
  created_at: string
}
export interface OAuthStore {
  app(id: string): Promise<Application | null>
  grant(id: string): Promise<Grant | null>
  code(hash: string): Promise<Code | null>
  saveCode(code: Code): Promise<void>
  consumeCode(hash: string): Promise<boolean>
  token(hash: string, kind: "access" | "refresh"): Promise<TokenPair | null>
  saveToken(token: TokenPair): Promise<void>
  consumeRefresh(hash: string): Promise<boolean>
}
