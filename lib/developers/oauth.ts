import OAuth2Server from "@node-oauth/oauth2-server"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { approvedScopes } from "./policy"
import type { Application, OAuthStore } from "./types"

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
export function randomSecret() {
  return randomBytes(32).toString("base64url")
}
export function matchesSecret(value: string, hash: string | null) {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return false
  return timingSafeEqual(
    Buffer.from(hashSecret(value), "hex"),
    Buffer.from(hash, "hex")
  )
}
function clientOf(app: Application): OAuth2Server.Client {
  return {
    id: app.id,
    redirectUris: app.redirect_uris,
    grants: ["authorization_code", "refresh_token"],
  }
}

export function createOAuthServer(
  store: OAuthStore,
  mode: "authorize" | "token"
) {
  async function activeGrant(id: string) {
    const grant = await store.grant(id)
    if (!grant || Date.parse(grant.expires_at) <= Date.now()) return null
    const app = await store.app(grant.app_id)
    if (!app?.enabled || !approvedScopes(grant.scopes, app.approved_scopes))
      return null
    return {
      grant,
      app,
      client: clientOf(app),
      user: { id: grant.user_id, grantId: grant.id },
    }
  }
  async function storedToken(raw: string, kind: "access" | "refresh") {
    const pair = await store.token(hashSecret(raw), kind)
    if (!pair || (kind === "access" && pair.refresh_used)) return null
    const active = await activeGrant(pair.grant_id)
    if (!active || !approvedScopes(pair.scopes, active.grant.scopes))
      return null
    return { ...active, pair }
  }
  const model: OAuth2Server.AuthorizationCodeModel &
    OAuth2Server.RefreshTokenModel = {
    async getClient(id, secret) {
      const app = await store.app(id)
      if (!app?.enabled) return false
      if (
        mode === "token" &&
        app.client_type === "confidential" &&
        (!secret || !matchesSecret(secret, app.secret_hash))
      )
        return false
      return clientOf(app)
    },
    async validateRedirectUri(uri, client) {
      const app = await store.app(client.id)
      return !!app?.enabled && app.redirect_uris.includes(uri)
    },
    async validateScope(user, client, scopes) {
      const active = await activeGrant(String(user.grantId))
      if (
        !active ||
        active.grant.user_id !== user.id ||
        active.app.id !== client.id
      )
        return false
      return approvedScopes(scopes ?? [], active.grant.scopes)
    },
    async generateAuthorizationCode() {
      return randomSecret()
    },
    async generateAccessToken() {
      return randomSecret()
    },
    async generateRefreshToken() {
      return randomSecret()
    },
    async saveAuthorizationCode(code, client, user) {
      const active = await activeGrant(String(user.grantId))
      if (
        !active ||
        active.app.id !== client.id ||
        active.grant.user_id !== user.id ||
        !approvedScopes(code.scope ?? [], active.grant.scopes)
      )
        throw new OAuth2Server.InvalidGrantError("Authorization unavailable")
      if (code.codeChallengeMethod !== "S256" || !code.codeChallenge)
        throw new OAuth2Server.InvalidRequestError("S256 PKCE required")
      await store.saveCode({
        hash: hashSecret(code.authorizationCode),
        grant_id: active.grant.id,
        scopes: code.scope ?? [],
        redirect_uri: code.redirectUri,
        challenge: code.codeChallenge,
        expires_at: code.expiresAt.toISOString(),
      })
      return { ...code, client, user }
    },
    async getAuthorizationCode(raw) {
      const code = await store.code(hashSecret(raw))
      if (!code) return false
      const active = await activeGrant(code.grant_id)
      if (!active || !approvedScopes(code.scopes, active.grant.scopes))
        return false
      return {
        authorizationCode: raw,
        expiresAt: new Date(code.expires_at),
        redirectUri: code.redirect_uri,
        codeChallenge: code.challenge,
        codeChallengeMethod: "S256",
        scope: code.scopes,
        client: active.client,
        user: active.user,
      }
    },
    async revokeAuthorizationCode(code) {
      return store.consumeCode(hashSecret(code.authorizationCode))
    },
    async saveToken(token, client, user) {
      const active = await activeGrant(String(user.grantId))
      if (
        !active ||
        active.app.id !== client.id ||
        active.grant.user_id !== user.id ||
        !approvedScopes(token.scope ?? [], active.grant.scopes)
      )
        throw new OAuth2Server.InvalidGrantError("Authorization unavailable")
      if (
        !token.refreshToken ||
        !token.accessTokenExpiresAt ||
        !token.refreshTokenExpiresAt
      )
        throw new Error("Incomplete token pair")
      const refreshExpiry = new Date(
        Math.min(
          token.refreshTokenExpiresAt.getTime(),
          Date.parse(active.grant.expires_at)
        )
      )
      await store.saveToken({
        access_hash: hashSecret(token.accessToken),
        refresh_hash: hashSecret(token.refreshToken),
        refresh_used: false,
        grant_id: active.grant.id,
        scopes: token.scope!,
        access_expires_at: token.accessTokenExpiresAt.toISOString(),
        refresh_expires_at: refreshExpiry.toISOString(),
      })
      return {
        ...token,
        accessToken: String(token.accessToken),
        refreshTokenExpiresAt: refreshExpiry,
        client,
        user,
      }
    },
    async getAccessToken(raw) {
      const active = await storedToken(raw, "access")
      if (!active) return false
      return {
        accessToken: raw,
        accessTokenExpiresAt: new Date(active.pair.access_expires_at),
        scope: active.pair.scopes,
        client: active.client,
        user: active.user,
      }
    },
    async getRefreshToken(raw) {
      const active = await storedToken(raw, "refresh")
      if (!active) return false
      return {
        refreshToken: raw,
        refreshTokenExpiresAt: new Date(active.pair.refresh_expires_at),
        scope: active.pair.scopes,
        client: active.client,
        user: active.user,
      }
    },
    async revokeToken(token) {
      return store.consumeRefresh(hashSecret(token.refreshToken))
    },
    async verifyScope(token, scopes) {
      return scopes.every((s) => token.scope?.includes(s))
    },
  }
  return new OAuth2Server({
    model,
    accessTokenLifetime: 600,
    refreshTokenLifetime: 30 * 86400,
    authorizationCodeLifetime: 120,
    requirePKCE: true,
    allowEmptyState: false,
    allowBearerTokensInQueryString: false,
    requireClientAuthentication: {
      authorization_code: false,
      refresh_token: false,
    },
  })
}
