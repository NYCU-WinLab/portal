import { Refusal } from "./define"
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
  memberProjects,
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
import { randomUUID } from "node:crypto"

import { TokenRefused, verifiedAccessClaims } from "@/lib/auth/keycloak-token"
import { open, seal } from "@/lib/developers/seal"
import {
  accountConsoleUrl,
  getKeycloakUser,
  keycloakUserGroups,
} from "@/lib/keycloak"
import {
  deleteClient,
  developerApiAudience,
  registerClient,
  registrarConfigured,
  RegistrationLost,
  reissueRegistrationToken,
  RESTRICTED_SCOPES,
  updateClient,
  type ClientSpec,
} from "@/lib/keycloak-registration"

// Applications that sign members in with their lab account (/developers).
// New ones are Keycloak clients (lib/keycloak-registration.ts): Keycloak
// signs members in, asks their consent and issues the tokens, and portal's
// /api/developers/{profile,name,groups} takes those tokens. Applications
// registered before keep portal's own OAuth service (S256 PKCE at the old
// portal's paths) until their owner moves them to Keycloak.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type AppRow = typeof developerApps.$inferSelect

const restrictedOf = (scopes: string[]) =>
  scopes.filter((s): s is "name" | "groups" => s === "name" || s === "groups")

const specOf = (row: AppRow): ClientSpec => ({
  clientId: row.id,
  name: row.name,
  description: row.description,
  public: row.clientType === "public",
  redirectUris: row.redirectUris,
  restricted: restrictedOf(row.approvedScopes),
  on: row.enabled,
})

/** The application row, locked for this transaction. */
async function lockApp(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(developerApps)
    .where(eq(developerApps.id, id))
    .for("update")
  if (!row) throw new Refusal("找不到應用程式")
  return row
}

/**
 * Writes an application's Keycloak client from its row as changed in this
 * transaction. Keycloak hands out a new registration token on every update,
 * so it is stored in the same transaction: a failure here rolls back the
 * row change too. Applications not in Keycloak are left alone.
 */
async function syncClient(
  tx: Tx,
  row: AppRow,
  change: { secret?: string; revoke?: boolean; offline?: boolean } = {}
) {
  if (!row.keycloakRat) return
  const notBefore = change.revoke ? Math.floor(Date.now() / 1000) : undefined
  let rat: string | undefined
  try {
    rat = await updateClient(specOf(row), open(row.keycloakRat), {
      secret: change.secret,
      notBefore,
    })
  } catch (error) {
    if (!(error instanceof RegistrationLost)) throw error
    // Turning an application off must work even then: portal's API checks
    // enabled and notBefore itself, so the row alone cuts the data off.
    if (!change.offline) throw lost(row.id)
    console.error(lost(row.id).message)
  }
  await tx
    .update(developerApps)
    .set({
      ...(rat ? { keycloakRat: seal(rat) } : {}),
      ...(notBefore ? { keycloakNotBefore: notBefore } : {}),
    })
    .where(eq(developerApps.id, row.id))
}

/** Portal no longer holds a working registration token for this client. */
const lost = (id: string) =>
  new Error(
    `developer app ${id}: Keycloak registration token no longer works; an admin can issue a new one with recover_developer_app_token`
  )

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
  if (!link) throw new Refusal("Member unavailable")
  return dataFor(link.sub, scope)
}

async function dataFor(sub: string, scope: Scope) {
  const member = await getKeycloakUser(sub)
  if (!member.enabled) throw new Refusal("Member unavailable")
  if (scope === "profile") return { sub, ...profileResponse(member) }
  if (scope === "name")
    return {
      sub,
      username: member.username,
      name:
        member.attributes?.chinese_name?.[0] ||
        [member.firstName, member.lastName].filter(Boolean).join(" ") ||
        null,
    }
  const groups = await keycloakUserGroups(sub)
  return {
    sub,
    username: member.username,
    groups: memberGroups(groups),
    projects: memberProjects(groups),
  }
}

/**
 * A member's data for a Keycloak access token of a /developers application:
 * issued for portal's developer API, to an application that is on and is a
 * Keycloak client, carrying the scope the member consented to, which a portal
 * admin approved for that application. TokenRefused otherwise.
 */
export async function keycloakMemberData(token: string, scope: Scope) {
  const claims = await verifiedAccessClaims(token, developerApiAudience())
  const clientId = String(claims.azp ?? "")
  const [app] = uuid.test(clientId)
    ? await db
        .select()
        .from(developerApps)
        .where(eq(developerApps.id, clientId))
    : []
  if (!app?.enabled || !app.keycloakRat)
    throw new TokenRefused(401, "token not issued to an active application")
  // Keycloak's notBefore stops refreshes; a token issued earlier still
  // verifies here until it expires, so compare it with the last revocation.
  if ((claims.iat ?? 0) < (app.keycloakNotBefore ?? 0))
    throw new TokenRefused(401, "token revoked")
  const granted = String(claims.scope ?? "").split(" ")
  const needed =
    scope === "profile" ? "portal-profile" : RESTRICTED_SCOPES[scope]
  if (!granted.includes(needed) || !app.approvedScopes.includes(scope))
    throw new TokenRefused(403, "insufficient_scope")
  return {
    data: await dataFor(claims.sub, scope),
    redirectUris: app.redirectUris,
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
    throw new Refusal("無效或已停用的應用程式或回呼網址")
  const scopes = approvedScopes(
    input.scope.split(" ").filter(Boolean),
    row.approvedScopes
  )
  if (!scopes) throw new Refusal("應用程式尚未獲准使用這些資料權限")
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
        throw new Refusal("無效或已停用的應用程式或回呼網址")
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
  keycloak: sql<boolean>`${developerApps.keycloakRat} is not null`,
}

/** An application the member owns, or any for a portal admin. */
async function manageable(actor: Actor, id: string) {
  const [app] = await db
    .select(appFields)
    .from(developerApps)
    .where(eq(developerApps.id, id))
  if (!app) throw new Refusal("找不到應用程式")
  if (app.ownerId !== actor.userId && !(await isAdmin(actor, "portal")))
    throw new Refusal("找不到應用程式")
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
    return {
      app,
      requests,
      activeGrants: grants.n,
      movable: !app.keycloak && registrarConfigured(),
    }
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
    if (owned.n >= 20) throw new Refusal("每位成員最多可註冊 20 個應用程式")
    const secret =
      input.client_type === "confidential" ? randomSecret() : undefined
    // The Keycloak client is made inside the transaction: if Keycloak
    // refuses, no application is left behind in portal.
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(developerApps)
        .values({
          id: randomUUID(),
          ownerId: actor.userId,
          name: input.name,
          description: input.description,
          contactEmail: input.contact_email,
          privacyUrl: input.privacy_url,
          clientType: input.client_type,
          redirectUris: input.redirect_uris,
          secretHash: secret ? hashSecret(secret) : null,
        })
        .returning()
      if (registrarConfigured()) {
        const rat = await registerClient(specOf(created), secret)
        await tx
          .update(developerApps)
          .set({ keycloakRat: seal(rat) })
          .where(eq(developerApps.id, created.id))
      }
      return { id: created.id, secret: secret ?? null }
    })
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
    await manageable(actor, id)
    const moved = await db.transaction(async (tx) => {
      const before = await lockApp(tx, id)
      const [row] = await tx
        .update(developerApps)
        .set({
          name: input.name,
          description: input.description,
          contactEmail: input.contact_email,
          privacyUrl: input.privacy_url,
          redirectUris: input.redirect_uris,
        })
        .where(eq(developerApps.id, id))
        .returning()
      const moved =
        JSON.stringify(before.redirectUris) !==
        JSON.stringify(input.redirect_uris)
      await syncClient(tx, row, { revoke: moved })
      return moved
    })
    if (moved) await invalidateGrants(id)
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
      throw new Refusal("Public client 不使用 secret")
    const secret = randomSecret()
    await db.transaction(async (tx) => {
      await lockApp(tx, id)
      const [row] = await tx
        .update(developerApps)
        .set({ secretHash: hashSecret(secret) })
        .where(eq(developerApps.id, id))
        .returning()
      await syncClient(tx, row, { secret, revoke: true })
    })
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
    await db.transaction(async (tx) => {
      await lockApp(tx, id)
      const [row] = await tx
        .update(developerApps)
        .set({ enabled })
        .where(eq(developerApps.id, id))
        .returning()
      // Off closes sign-in at Keycloak and ends the tokens already issued.
      await syncClient(tx, row, { revoke: true, offline: !enabled })
    })
    await invalidateGrants(id)
    return { id, enabled }
  },
})

export const deleteDeveloperApp = defineAction({
  name: "delete_developer_app",
  title: "刪除應用程式",
  description:
    "Deletes an application for good (its owner or a portal admin): the client id stops working, and every consent, token and scope request goes with it. It cannot be undone; to stop an application for now, disable it instead. Delete only after the member confirms the application by name.",
  kind: "mutation",
  idempotent: true,
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await manageable(actor, id)
    await db.transaction(async (tx) => {
      const row = await lockApp(tx, id)
      if (row.keycloakRat) {
        try {
          await deleteClient(row.id, open(row.keycloakRat))
        } catch (error) {
          // Without the row the client reads nothing from portal; an admin
          // removes the leftover Keycloak client.
          if (!(error instanceof RegistrationLost)) throw error
          console.error(lost(row.id).message)
        }
      }
      // Scope requests, grants, codes and tokens cascade from the application.
      await tx.delete(developerApps).where(eq(developerApps.id, id))
    })
    return { id }
  },
})

export const recoverDeveloperAppToken = defineAction({
  name: "recover_developer_app_token",
  title: "復原應用程式的註冊 token",
  description:
    "Issues a new Keycloak registration token for an application whose stored token no longer works (portal admins only). Safe to repeat. Returns the application id; the token stays sealed in portal.",
  kind: "mutation",
  idempotent: true,
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "portal")
    await db.transaction(async (tx) => {
      const row = await lockApp(tx, id)
      if (!row.keycloakRat)
        throw new Refusal("這個應用程式不是 Keycloak client")
      const token = await reissueRegistrationToken(row.id)
      await tx
        .update(developerApps)
        .set({ keycloakRat: seal(token) })
        .where(eq(developerApps.id, id))
    })
    return { id }
  },
})

export const moveDeveloperAppToKeycloak = defineAction({
  name: "move_developer_app_to_keycloak",
  title: "改用 Keycloak",
  description:
    "Makes an application registered before Keycloak sign-in a Keycloak client with the same client id (its owner or a portal admin). A confidential application gets a new secret for Keycloak, returned once; its old secret keeps working on portal's old OAuth paths until they close.",
  kind: "mutation",
  mcpExcludedBecause:
    "the new secret is shown once and belongs in the owner's server, not an agent's context",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await manageable(actor, id)
    if (!registrarConfigured())
      throw new Error("Keycloak registrar is not set up")
    return db.transaction(async (tx) => {
      const row = await lockApp(tx, id)
      if (row.keycloakRat) throw new Refusal("這個應用程式已經改用 Keycloak")
      const secret =
        row.clientType === "confidential" ? randomSecret() : undefined
      const rat = await registerClient(specOf(row), secret)
      await tx
        .update(developerApps)
        .set({ keycloakRat: seal(rat) })
        .where(eq(developerApps.id, id))
      return { id, secret: secret ?? null }
    })
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
      throw new Refusal("只有應用程式擁有者可以申請")
    const [pending] = await db
      .select({ id: developerScopeRequests.id })
      .from(developerScopeRequests)
      .where(
        and(
          eq(developerScopeRequests.appId, input.app_id),
          eq(developerScopeRequests.status, "pending")
        )
      )
    if (pending) throw new Refusal("這個應用程式已有待審核申請")
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
  admin: "portal",
  title: "待審資料權限",
  description:
    "Pending scope requests from every application, oldest first, for portal admins: application, owner, scopes and purpose.",
  kind: "query",
  input: z.object({}),
  run: async () => {
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
  admin: "portal",
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
    return db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(developerScopeRequests)
        .where(eq(developerScopeRequests.id, input.id))
        .for("update")
      if (request?.status !== "pending") throw new Refusal("這筆申請不是待審")
      if (input.approve) {
        await lockApp(tx, request.appId)
        const [app] = await tx
          .update(developerApps)
          .set({
            approvedScopes: sql`array(select distinct unnest(${developerApps.approvedScopes} || array[${sql.join(
              request.scopes.map((scope) => sql`${scope}`),
              sql`, `
            )}]::text[]))`,
          })
          .where(eq(developerApps.id, request.appId))
          .returning()
        // A Keycloak client may now ask for the scope; each member still
        // consents to it at their next sign-in.
        await syncClient(tx, app)
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
    "How an application signs members in, as steps to copy: send the member to the authorize page, exchange the code, read the resources per scope, refresh, revoke; then the rules (S256 PKCE, exact redirect URIs, 10-minute access tokens, single-use refresh tokens, consent for up to 30 days). With id (an application the member owns, any for a portal admin) the steps carry its client id, its client type and its approved scopes; without it they show a confidential client with placeholders.",
  kind: "query",
  input: z.object({ id: z.uuid().optional() }),
  run: async (actor, { id }) => {
    const app = id ? await manageable(actor, id) : null
    if (app ? app.keycloak : registrarConfigured()) return keycloakSteps(app)
    const base = process.env.BETTER_AUTH_URL
    const client = app?.id ?? "<client id>"
    const scopes = (app?.approvedScopes ?? Object.keys(SCOPES)).filter(
      (scope): scope is Scope => Object.hasOwn(SCOPES, scope)
    )
    // A confidential client proves itself with its secret; a public one
    // only names itself.
    const credentials =
      app?.clientType === "public"
        ? `-d client_id=${client}`
        : `-u ${client}:<secret>`
    const post = (path: string, ...fields: string[]) =>
      [`curl ${base}/api/developers/oauth/${path}`, credentials, ...fields]
        .map((line, index) => (index ? `  ${line}` : line))
        .join(" \\\n")
    return {
      steps: [
        {
          title: "1. 把成員導到授權頁",
          code: [
            `${base}/developers/authorize`,
            "  ?response_type=code",
            `  &client_id=${client}`,
            "  &redirect_uri=<uri>",
            `  &scope=${scopes.join("+")}`,
            "  &state=<state>",
            "  &code_challenge=<S256>",
            "  &code_challenge_method=S256",
          ].join("\n"),
        },
        {
          title: "2. 用 code 換 token",
          code: post(
            "token",
            "-d grant_type=authorization_code",
            "-d code=<code>",
            "-d redirect_uri=<uri>",
            "-d code_verifier=<verifier>"
          ),
        },
        {
          title: "3. 讀資料",
          code: scopes
            .map(
              (scope) =>
                `# ${SCOPES[scope].label}\ncurl ${base}/api/developers/${scope} \\\n  -H "Authorization: Bearer <access token>"`
            )
            .join("\n\n"),
        },
        {
          title: "4. 換新的 token",
          code: post(
            "token",
            "-d grant_type=refresh_token",
            "-d refresh_token=<refresh token>"
          ),
        },
        {
          title: "5. 結束授權",
          code: post("revoke", "-d token=<access or refresh token>"),
        },
      ],
      rules: [
        "必須用 S256 PKCE，並帶 state",
        "redirect_uri 要與註冊的完全相同",
        "access token 10 分鐘；refresh token 只能用 1 次，重複使用會結束授權",
        "授權最長 30 天；secret、回呼網址、權限或狀態改變時結束",
        "姓名與群組要先經 Portal 管理員核准",
      ],
    }
  },
})

/** How a Keycloak client application signs members in and reads their data. */
function keycloakSteps(
  app: { id: string; clientType: string; approvedScopes: string[] } | null
) {
  const base = process.env.BETTER_AUTH_URL
  const oidc = `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect`
  const client = app?.id ?? "<client id>"
  const scopes = (app?.approvedScopes ?? Object.keys(SCOPES)).filter(
    (scope): scope is Scope => Object.hasOwn(SCOPES, scope)
  )
  const asked = [
    "openid",
    ...restrictedOf(scopes).map((s) => RESTRICTED_SCOPES[s]),
  ]
  const credentials =
    app?.clientType === "public"
      ? `-d client_id=${client}`
      : `-u ${client}:<secret>`
  const post = (path: string, ...fields: string[]) =>
    [`curl ${oidc}/${path}`, credentials, ...fields]
      .map((line, index) => (index ? `  ${line}` : line))
      .join(" \\\n")
  return {
    steps: [
      {
        title: "1. 把成員導到 Keycloak 登入",
        code: [
          `${oidc}/auth`,
          "  ?response_type=code",
          `  &client_id=${client}`,
          "  &redirect_uri=<uri>",
          `  &scope=${asked.join("+")}`,
          "  &state=<state>",
          "  &code_challenge=<S256>",
          "  &code_challenge_method=S256",
        ].join("\n"),
      },
      {
        title: "2. 用 code 換 token",
        code: post(
          "token",
          "-d grant_type=authorization_code",
          "-d code=<code>",
          "-d redirect_uri=<uri>",
          "-d code_verifier=<verifier>"
        ),
      },
      {
        title: "3. 讀資料",
        code: scopes
          .map(
            (scope) =>
              `# ${SCOPES[scope].label}\ncurl ${base}/api/developers/${scope} \\\n  -H "Authorization: Bearer <access token>"`
          )
          .join("\n\n"),
      },
      {
        title: "4. 換新的 token",
        code: post(
          "token",
          "-d grant_type=refresh_token",
          "-d refresh_token=<refresh token>"
        ),
      },
      {
        title: "5. 登出",
        code: post("revoke", "-d token=<refresh token>"),
      },
    ],
    rules: [
      `OpenID Connect 設定：${process.env.KEYCLOAK_ISSUER}/.well-known/openid-configuration`,
      "必須用 S256 PKCE，並帶 state",
      "redirect_uri 要與註冊的完全相同",
      "成員在 Keycloak 同意授權，可在帳號主控台的應用程式頁撤銷",
      "sub 是成員的 Keycloak 帳號 ID，與舊的 Portal 授權相同",
      "姓名與群組要先經 Portal 管理員核准",
    ],
  }
}

export const listMyAuthorizations = defineAction({
  name: "list_my_authorizations",
  title: "我的授權",
  description:
    "The applications the signed-in member currently lets read their data through portal's own OAuth service, with the scopes and when each consent expires. Applications that sign in with Keycloak are listed, and revoked, in the Keycloak account console (keycloakConsole).",
  kind: "query",
  input: z.object({}),
  run: async (actor) => ({
    keycloakConsole: `${accountConsoleUrl()}/applications`,
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
  idempotent: true,
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
