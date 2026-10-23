import OAuth2Server from "@node-oauth/oauth2-server"
import { and, count, desc, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { defineAction, type Actor } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  account,
  developerApps,
  developerCodes,
  developerGrants,
  developerScopeRequests,
  developerTokens,
  user,
} from "@/lib/db/schema"
import {
  createOAuthServer,
  hashSecret,
  randomSecret,
} from "@/lib/developers/oauth"
import {
  applicationInput,
  approvedScopes,
  authorizeInput,
  memberGroups,
  profileResponse,
  SCOPES,
  type AuthorizationInput,
  type Scope,
} from "@/lib/developers/policy"
import type {
  Application,
  Code,
  Grant,
  OAuthStore,
  TokenPair,
} from "@/lib/developers/types"
import { getKeycloakUser, keycloakUserGroups } from "@/lib/keycloak"

// Applications that sign members in with their lab account (/developers):
// OAuth 2.0 authorization code with S256 PKCE, at the old portal's paths
// (/developers/authorize, /api/developers/oauth/token, /api/developers/
// {profile,name,groups}) so registered applications keep working.

const appRow = (row: typeof developerApps.$inferSelect): Application => ({
  id: row.id,
  owner_id: row.ownerId,
  name: row.name,
  description: row.description,
  contact_email: row.contactEmail,
  privacy_url: row.privacyUrl,
  client_type: row.clientType as Application["client_type"],
  redirect_uris: row.redirectUris,
  approved_scopes: row.approvedScopes,
  enabled: row.enabled,
  secret_hash: row.secretHash,
  created_at: row.createdAt.toISOString(),
})

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The token service's storage, for lib/developers/oauth.ts. */
export function createOAuthStore(): OAuthStore {
  return {
    async app(id) {
      if (!uuid.test(id)) return null
      const [row] = await db
        .select()
        .from(developerApps)
        .where(eq(developerApps.id, id))
      return row ? appRow(row) : null
    },
    async grant(id) {
      if (!uuid.test(id)) return null
      const [row] = await db
        .select()
        .from(developerGrants)
        .where(eq(developerGrants.id, id))
      return row
        ? ({
            id: row.id,
            app_id: row.appId,
            user_id: row.userId,
            scopes: row.scopes,
            created_at: row.createdAt.toISOString(),
            expires_at: row.expiresAt.toISOString(),
          } satisfies Grant)
        : null
    },
    async code(hash) {
      const [row] = await db
        .select()
        .from(developerCodes)
        .where(eq(developerCodes.hash, hash))
      return row
        ? ({
            hash: row.hash,
            grant_id: row.grantId,
            scopes: row.scopes,
            redirect_uri: row.redirectUri,
            challenge: row.challenge,
            expires_at: row.expiresAt.toISOString(),
          } satisfies Code)
        : null
    },
    async saveCode(code) {
      await db.insert(developerCodes).values({
        hash: code.hash,
        grantId: code.grant_id,
        scopes: code.scopes,
        redirectUri: code.redirect_uri,
        challenge: code.challenge,
        expiresAt: new Date(code.expires_at),
      })
    },
    async consumeCode(hash) {
      const gone = await db
        .delete(developerCodes)
        .where(eq(developerCodes.hash, hash))
        .returning({ hash: developerCodes.hash })
      return gone.length === 1
    },
    async token(hash, kind) {
      const [row] = await db
        .select()
        .from(developerTokens)
        .where(
          kind === "access"
            ? eq(developerTokens.accessHash, hash)
            : eq(developerTokens.refreshHash, hash)
        )
      return row
        ? ({
            access_hash: row.accessHash,
            refresh_hash: row.refreshHash,
            refresh_used: row.refreshUsed,
            grant_id: row.grantId,
            scopes: row.scopes,
            access_expires_at: row.accessExpiresAt.toISOString(),
            refresh_expires_at: row.refreshExpiresAt.toISOString(),
          } satisfies TokenPair)
        : null
    },
    async saveToken(token) {
      await db.insert(developerTokens).values({
        accessHash: token.access_hash,
        refreshHash: token.refresh_hash,
        refreshUsed: token.refresh_used,
        grantId: token.grant_id,
        scopes: token.scopes,
        accessExpiresAt: new Date(token.access_expires_at),
        refreshExpiresAt: new Date(token.refresh_expires_at),
      })
    },
    // A refresh token works once; presenting a used one again means it
    // leaked, so the whole consent goes.
    async consumeRefresh(hash) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(developerTokens)
          .where(eq(developerTokens.refreshHash, hash))
          .for("update")
        if (!row) return false
        if (row.refreshUsed) {
          await tx
            .delete(developerGrants)
            .where(eq(developerGrants.id, row.grantId))
          return false
        }
        await tx
          .update(developerTokens)
          .set({ refreshUsed: true })
          .where(eq(developerTokens.refreshHash, hash))
        return true
      })
    },
  }
}

/** Ends every consent to an application whose terms just changed. */
async function invalidateGrants(appId: string) {
  await db.delete(developerGrants).where(eq(developerGrants.appId, appId))
}

/** What a resource endpoint returns for a member, read live from Keycloak. */
export async function memberData(userId: string, scope: Scope) {
  const [link] = await db
    .select({ sub: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "keycloak")))
  if (!link) throw new Error("Member unavailable")
  const member = await getKeycloakUser(link.sub)
  if (!member.enabled) throw new Error("Member unavailable")
  if (scope === "profile") return profileResponse(member)
  if (scope === "name")
    return {
      username: member.username,
      name:
        member.attributes?.chinese_name?.[0] ||
        [member.firstName, member.lastName].filter(Boolean).join(" ") ||
        null,
    }
  return {
    username: member.username,
    groups: memberGroups(await keycloakUserGroups(link.sub)),
  }
}

/** The application an authorize request names, if it may ask for this. */
export async function authorizationDetails(raw: unknown) {
  const input = authorizeInput.parse(raw)
  const [row] = uuid.test(input.client_id)
    ? await db
        .select()
        .from(developerApps)
        .where(eq(developerApps.id, input.client_id))
    : []
  if (!row?.enabled || !row.redirectUris.includes(input.redirect_uri))
    throw new Error("無效或已停用的應用程式或回呼網址")
  const scopes = approvedScopes(
    input.scope.split(" ").filter(Boolean),
    row.approvedScopes
  )
  if (!scopes) throw new Error("應用程式尚未獲准使用這些資料權限")
  return { app: appRow(row), input, scopes }
}

export const authorizeDeveloperApp = defineAction({
  name: "authorize_developer_app",
  title: "授權應用程式",
  description:
    "The member's answer on the consent page: approve gives the application a 30-day grant and returns where to send the browser with a code; deny returns the application's error redirect.",
  kind: "mutation",
  mcpExcludedBecause:
    "consent is the member's own decision in the browser, never an agent's",
  input: z.object({
    request: authorizeInput,
    approve: z.boolean(),
  }),
  run: async (actor, { request, approve }) => {
    const details = await authorizationDetails(request)
    const target = new URL(details.input.redirect_uri)
    target.searchParams.set("state", details.input.state)
    if (!approve) {
      target.searchParams.set("error", "access_denied")
      return { redirect: target.toString() }
    }
    // The app is re-read under a share lock, so an owner changing it at the
    // same moment either waits for this grant (and then ends it) or wins.
    const grant = await db.transaction(async (tx) => {
      const [app] = await tx
        .select()
        .from(developerApps)
        .where(eq(developerApps.id, details.app.id))
        .for("share")
      if (
        !app?.enabled ||
        !app.redirectUris.includes(details.input.redirect_uri) ||
        !approvedScopes(details.scopes, app.approvedScopes)
      )
        throw new Error("無效或已停用的應用程式或回呼網址")
      const [created] = await tx
        .insert(developerGrants)
        .values({
          appId: app.id,
          userId: actor.userId,
          scopes: details.scopes,
        })
        .returning({ id: developerGrants.id })
      return created
    })
    try {
      const code = await createOAuthServer(
        createOAuthStore(),
        "authorize"
      ).authorize(
        new OAuth2Server.Request({
          method: "GET",
          headers: {},
          query: details.input as AuthorizationInput,
        }),
        new OAuth2Server.Response(),
        {
          authenticateHandler: {
            handle: () => ({ id: actor.userId, grantId: grant.id }),
          },
        }
      )
      target.searchParams.set("code", code.authorizationCode)
    } catch {
      await db.delete(developerGrants).where(eq(developerGrants.id, grant.id))
      target.searchParams.set("error", "temporarily_unavailable")
    }
    return { redirect: target.toString() }
  },
})

const appFields = {
  id: developerApps.id,
  name: developerApps.name,
  description: developerApps.description,
  contactEmail: developerApps.contactEmail,
  privacyUrl: developerApps.privacyUrl,
  clientType: developerApps.clientType,
  redirectUris: developerApps.redirectUris,
  approvedScopes: developerApps.approvedScopes,
  enabled: developerApps.enabled,
  ownerId: developerApps.ownerId,
  createdAt: developerApps.createdAt,
}

/** An application the member owns, or any for a portal admin. */
async function manageable(actor: Actor, id: string) {
  const [app] = await db
    .select(appFields)
    .from(developerApps)
    .where(eq(developerApps.id, id))
  if (!app) throw new Error("找不到應用程式")
  if (app.ownerId !== actor.userId && !(await isAdmin(actor, "portal")))
    throw new Error("找不到應用程式")
  return app
}

export const listDeveloperApps = defineAction({
  name: "list_developer_apps",
  title: "我的應用程式",
  description:
    "The applications the signed-in member registered on /developers to sign people in with their lab account: client id (id), name, client type, redirect URIs, approved scopes, enabled. Own applications only, admins included.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => ({
    apps: await db
      .select(appFields)
      .from(developerApps)
      .where(eq(developerApps.ownerId, actor.userId))
      .orderBy(desc(developerApps.createdAt)),
  }),
})

export const getDeveloperApp = defineAction({
  name: "get_developer_app",
  title: "應用程式詳情",
  description:
    "One application the member owns (any, for a portal admin), with its scope requests and how many members currently authorize it.",
  kind: "query",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    const app = await manageable(actor, id)
    const requests = await db
      .select()
      .from(developerScopeRequests)
      .where(eq(developerScopeRequests.appId, id))
      .orderBy(desc(developerScopeRequests.createdAt))
    const [grants] = await db
      .select({ n: count() })
      .from(developerGrants)
      .where(
        and(
          eq(developerGrants.appId, id),
          gt(developerGrants.expiresAt, sql`now()`)
        )
      )
    return { app, requests, activeGrants: grants.n }
  },
})

export const registerDeveloperApp = defineAction({
  name: "register_developer_app",
  title: "註冊應用程式",
  description:
    "Registers an application for the member: name, description, contact email, an https privacy policy URL, client type (confidential for a server, public for a browser or app) and 1 to 10 exact redirect URIs (https, or http on localhost). It starts with the profile scope. A confidential client's secret is returned once: store it only in the server-side secret store, never in frontend code or source control. Register only after the member confirms every field and accepts the data-use terms.",
  kind: "mutation",
  input: applicationInput,
  run: async (actor, input) => {
    const [owned] = await db
      .select({ n: count() })
      .from(developerApps)
      .where(eq(developerApps.ownerId, actor.userId))
    if (owned.n >= 20) throw new Error("每位成員最多可註冊 20 個應用程式")
    const secret =
      input.client_type === "confidential" ? randomSecret() : undefined
    const [created] = await db
      .insert(developerApps)
      .values({
        ownerId: actor.userId,
        name: input.name,
        description: input.description,
        contactEmail: input.contact_email,
        privacyUrl: input.privacy_url,
        clientType: input.client_type,
        redirectUris: input.redirect_uris,
        secretHash: secret ? hashSecret(secret) : null,
      })
      .returning({ id: developerApps.id })
    return { id: created.id, secret: secret ?? null }
  },
})

export const updateDeveloperApp = defineAction({
  name: "update_developer_app",
  title: "修改應用程式",
  description:
    "Changes one of the member's applications (name, description, contact, privacy URL, redirect URIs; the client type stays). Changing redirect URIs ends every current consent.",
  kind: "mutation",
  input: applicationInput.omit({ client_type: true }).extend({ id: z.uuid() }),
  run: async (actor, { id, ...input }) => {
    const app = await manageable(actor, id)
    await db
      .update(developerApps)
      .set({
        name: input.name,
        description: input.description,
        contactEmail: input.contact_email,
        privacyUrl: input.privacy_url,
        redirectUris: input.redirect_uris,
      })
      .where(eq(developerApps.id, id))
    if (
      JSON.stringify(app.redirectUris) !== JSON.stringify(input.redirect_uris)
    )
      await invalidateGrants(id)
    return { id }
  },
})

export const rotateDeveloperSecret = defineAction({
  name: "rotate_developer_secret",
  title: "更換 secret",
  description:
    "Issues a new client secret for a confidential application and ends every current consent.",
  kind: "mutation",
  mcpExcludedBecause:
    "a new secret is shown once and belongs in the owner's server, not an agent's context",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    const app = await manageable(actor, id)
    if (app.clientType !== "confidential")
      throw new Error("Public client 不使用 secret")
    const secret = randomSecret()
    await db
      .update(developerApps)
      .set({ secretHash: hashSecret(secret) })
      .where(eq(developerApps.id, id))
    await invalidateGrants(id)
    return { secret }
  },
})

export const setDeveloperAppEnabled = defineAction({
  name: "set_developer_app_enabled",
  title: "停用或啟用應用程式",
  description:
    "Disables an application (its owner or a portal admin) or enables it again (portal admins only). Either ends every current consent.",
  kind: "mutation",
  input: z.object({ id: z.uuid(), enabled: z.boolean() }),
  run: async (actor, { id, enabled }) => {
    await manageable(actor, id)
    if (enabled) await requireAdmin(actor, "portal")
    await db
      .update(developerApps)
      .set({ enabled })
      .where(eq(developerApps.id, id))
    await invalidateGrants(id)
    return { id, enabled }
  },
})

export const requestDeveloperScopes = defineAction({
  name: "request_developer_scopes",
  title: "申請資料權限",
  description:
    "Asks a portal admin to let one of the member's applications use the restricted scopes name and/or groups, with the purpose (10 to 2000 characters). One pending request per application; members still consent one by one.",
  kind: "mutation",
  input: z.object({
    app_id: z.uuid(),
    scopes: z
      .array(z.enum(["name", "groups"]))
      .min(1)
      .max(2),
    purpose: z.string().trim().min(10).max(2000),
  }),
  run: async (actor, input) => {
    const app = await manageable(actor, input.app_id)
    if (app.ownerId !== actor.userId)
      throw new Error("只有應用程式擁有者可以申請")
    const [pending] = await db
      .select({ id: developerScopeRequests.id })
      .from(developerScopeRequests)
      .where(
        and(
          eq(developerScopeRequests.appId, input.app_id),
          eq(developerScopeRequests.status, "pending")
        )
      )
    if (pending) throw new Error("這個應用程式已有待審核申請")
    const [created] = await db
      .insert(developerScopeRequests)
      .values({
        appId: input.app_id,
        scopes: [...new Set(input.scopes)],
        purpose: input.purpose,
      })
      .returning({ id: developerScopeRequests.id })
    return created
  },
})

export const listDeveloperScopeRequests = defineAction({
  name: "list_developer_scope_requests",
  title: "待審資料權限",
  description:
    "Pending scope requests from every application, oldest first, for portal admins: application, owner, scopes and purpose.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    await requireAdmin(actor, "portal")
    return {
      requests: await db
        .select({
          id: developerScopeRequests.id,
          appId: developerScopeRequests.appId,
          app: developerApps.name,
          owner: user.name,
          scopes: developerScopeRequests.scopes,
          purpose: developerScopeRequests.purpose,
          createdAt: developerScopeRequests.createdAt,
        })
        .from(developerScopeRequests)
        .innerJoin(
          developerApps,
          eq(developerApps.id, developerScopeRequests.appId)
        )
        .innerJoin(user, eq(user.id, developerApps.ownerId))
        .where(eq(developerScopeRequests.status, "pending"))
        .orderBy(developerScopeRequests.createdAt),
    }
  },
})

export const reviewDeveloperScopes = defineAction({
  name: "review_developer_scopes",
  title: "審核資料權限",
  description: "A portal admin approves or rejects a pending scope request.",
  kind: "mutation",
  mcpExcludedBecause:
    "granting access to members' data is a portal admin's own review on /developers/review",
  input: z.object({
    id: z.uuid(),
    approve: z.boolean(),
    note: z.string().trim().min(1).max(2000),
  }),
  run: async (actor, input) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(developerScopeRequests)
        .where(eq(developerScopeRequests.id, input.id))
        .for("update")
      if (request?.status !== "pending") throw new Error("這筆申請不是待審")
      if (input.approve) {
        await tx
          .update(developerApps)
          .set({
            approvedScopes: sql`array(select distinct unnest(${developerApps.approvedScopes} || ${request.scopes}::text[]))`,
          })
          .where(eq(developerApps.id, request.appId))
        await tx
          .delete(developerGrants)
          .where(eq(developerGrants.appId, request.appId))
      }
      await tx
        .update(developerScopeRequests)
        .set({
          status: input.approve ? "approved" : "rejected",
          reviewedBy: actor.userId,
          reviewedAt: sql`now()`,
          reviewNote: input.note,
        })
        .where(eq(developerScopeRequests.id, input.id))
      return { id: input.id, approved: input.approve }
    })
  },
})

export const getDeveloperIntegration = defineAction({
  name: "get_developer_integration",
  title: "串接方式",
  description:
    "How an application signs members in: the authorize, token and revoke endpoints, the resource endpoints per scope, and the rules (S256 PKCE, exact redirect URIs, 10-minute access tokens, single-use refresh tokens, consent for up to 30 days).",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const base = process.env.BETTER_AUTH_URL
    return {
      authorize: `${base}/developers/authorize?response_type=code&client_id=<id>&redirect_uri=<uri>&scope=profile&state=<state>&code_challenge=<S256>&code_challenge_method=S256`,
      token: `POST ${base}/api/developers/oauth/token (application/x-www-form-urlencoded; grant_type authorization_code with code, redirect_uri, code_verifier, or refresh_token; client_secret by Basic or form for confidential clients)`,
      revoke: `POST ${base}/api/developers/oauth/revoke (token=<access or refresh token>)`,
      resources: Object.fromEntries(
        Object.entries(SCOPES).map(([scope, meta]) => [
          scope,
          `GET ${base}/api/developers/${scope} with Authorization: Bearer <access token>: ${meta.description}`,
        ])
      ),
      rules: [
        "S256 PKCE is required; state is required",
        "redirect_uri must match one registered exactly",
        "access tokens last 10 minutes; a refresh token works once, and reusing one ends the consent",
        "a consent lasts at most 30 days and ends when the app's secret, redirect URIs, scopes or status change",
        "name and groups need a portal admin's approval first",
      ],
    }
  },
})

export const listMyAuthorizations = defineAction({
  name: "list_my_authorizations",
  title: "我的授權",
  description:
    "The applications the signed-in member currently lets read their data, with the scopes and when each consent expires.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => ({
    grants: await db
      .select({
        id: developerGrants.id,
        app: developerApps.name,
        scopes: developerGrants.scopes,
        createdAt: developerGrants.createdAt,
        expiresAt: developerGrants.expiresAt,
      })
      .from(developerGrants)
      .innerJoin(developerApps, eq(developerApps.id, developerGrants.appId))
      .where(
        and(
          eq(developerGrants.userId, actor.userId),
          gt(developerGrants.expiresAt, sql`now()`)
        )
      )
      .orderBy(desc(developerGrants.createdAt)),
  }),
})

export const revokeMyAuthorization = defineAction({
  name: "revoke_my_authorization",
  title: "撤銷授權",
  description:
    "Ends one of the signed-in member's consents (by id from list_my_authorizations); the application's tokens stop working at once.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await db
      .delete(developerGrants)
      .where(
        and(
          eq(developerGrants.id, id),
          eq(developerGrants.userId, actor.userId)
        )
      )
    return { revoked: true }
  },
})

/** For the revoke endpoint, which has already checked the application. */
export async function revokeGrantById(id: string) {
  await db.delete(developerGrants).where(eq(developerGrants.id, id))
}
