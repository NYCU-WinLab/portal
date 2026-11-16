import { createHash, randomBytes } from "node:crypto"

import { and, asc, count, desc, eq, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  account,
  sshKeyChanges,
  sshKeys,
  sshKeyServices,
  sshServiceGrants,
  sshServices,
  user,
} from "@/lib/db/schema"
import { labDirectory, realmAccounts } from "@/lib/keycloak"
import {
  hostedKeys,
  hostUsername,
  keyHostIds,
  keyHosts,
  type ParsedKey,
  parsePublicKey,
} from "@/lib/ssh-keys"

// SSH keys: a member keeps their public keys here and says which lab
// services may use each; a service's machines read its keys with the
// service's read key (readServiceKeys, behind /api/ssh-keys). Portal admins
// make the services and, for one that is not open, name who may use it.
// Who may log in is decided when a machine reads, not when a key is put in:
// a grant taken away or a member who left stops being served on the next
// read.

const MAX_KEYS = 20
const TOKEN_PREFIX = "wkk_"
const SERVICE_TOKEN = /^wkk_[A-Za-z0-9_-]{43}$/

const hash = (token: string) => createHash("sha256").update(token).digest("hex")

function newToken() {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url")
  return {
    token,
    tokenHash: hash(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Change = Omit<typeof sshKeyChanges.$inferInsert, "actorId">

const record = (tx: Tx, actor: Actor, change: Change) =>
  tx.insert(sshKeyChanges).values({ actorId: actor.userId, ...change })

/** The line a machine puts in authorized_keys: the key and whose it is. */
const line = (key: { type: string; blob: string }, username: string) =>
  `${key.type} ${key.blob} ${username}`

async function addKeys(
  actor: Actor,
  keys: (ParsedKey & { label: string })[],
  source: string
) {
  return db.transaction(async (tx) => {
    // One member's additions run one at a time, so the limit holds.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ssh_keys:${actor.userId}`}))`
    )
    const [{ held }] = await tx
      .select({ held: count() })
      .from(sshKeys)
      .where(eq(sshKeys.userId, actor.userId))
    const added = keys.length
      ? await tx
          .insert(sshKeys)
          .values(
            keys.map((key) => ({
              userId: actor.userId,
              label: key.label,
              type: key.type,
              blob: key.blob,
              fingerprint: key.fingerprint,
              source,
            }))
          )
          .onConflictDoNothing()
          .returning({ id: sshKeys.id, fingerprint: sshKeys.fingerprint })
      : []
    if (held + added.length > MAX_KEYS)
      throw new Error(`最多 ${MAX_KEYS} 把金鑰`)
    for (const key of added)
      await record(tx, actor, {
        action: "add_key",
        userId: actor.userId,
        fingerprint: key.fingerprint,
      })
    return added
  })
}

export const listMySshKeys = defineAction({
  name: "list_my_ssh_keys",
  title: "我的 SSH 金鑰",
  description:
    "The signed-in member's SSH public keys (id, label, type, fingerprint, the public key line, where it came from, when it was added, and the slugs of the services it is used in), and the services the member may use (slug and name). A key used in no service reaches no machine.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [keys, uses, services] = await Promise.all([
      db
        .select()
        .from(sshKeys)
        .where(eq(sshKeys.userId, actor.userId))
        .orderBy(asc(sshKeys.createdAt)),
      db
        .select({ keyId: sshKeyServices.keyId, slug: sshServices.slug })
        .from(sshKeyServices)
        .innerJoin(sshKeys, eq(sshKeys.id, sshKeyServices.keyId))
        .innerJoin(sshServices, eq(sshServices.id, sshKeyServices.serviceId))
        .where(eq(sshKeys.userId, actor.userId)),
      db
        .select({ slug: sshServices.slug, name: sshServices.name })
        .from(sshServices)
        .leftJoin(
          sshServiceGrants,
          and(
            eq(sshServiceGrants.serviceId, sshServices.id),
            eq(sshServiceGrants.userId, actor.userId)
          )
        )
        .where(
          sql`${sshServices.open} or ${sshServiceGrants.userId} is not null`
        )
        .orderBy(asc(sshServices.name)),
    ])
    return {
      keys: keys.map((key) => ({
        id: key.id,
        label: key.label,
        type: key.type,
        fingerprint: key.fingerprint,
        publicKey: `${key.type} ${key.blob}`,
        source: key.source,
        createdAt: key.createdAt,
        services: uses
          .filter((use) => use.keyId === key.id)
          .map((use) => use.slug),
      })),
      services,
    }
  },
})

export const listMemberSshKeys = defineAction({
  name: "list_member_ssh_keys",
  title: "成員的 SSH 公鑰",
  description:
    "Every SSH public key one lab member keeps on the portal, by their account username: one authorized_keys line each (type, key, username). Use it to encrypt a file to a member (age -R) or to let them into a machine you run. Fails when no member has that username.",
  kind: "query",
  input: z.object({ username: z.string().trim().min(1).max(64) }),
  run: async (_actor, { username }) => {
    const [member] = await db
      .select({ id: user.id, username: user.username })
      .from(user)
      .where(sql`lower(${user.username}) = ${username.toLowerCase()}`)
    if (!member?.username) throw new Error("找不到這個成員")
    const keys = await db
      .select({ type: sshKeys.type, blob: sshKeys.blob })
      .from(sshKeys)
      .where(eq(sshKeys.userId, member.id))
      .orderBy(asc(sshKeys.createdAt))
    return {
      username: member.username,
      keys: keys.map((key) => line(key, member.username!)),
    }
  },
})

export const addSshKey = defineAction({
  name: "add_ssh_key",
  title: "新增 SSH 金鑰",
  description:
    "Adds one SSH public key to the signed-in member: the whole line of a .pub file (ssh-ed25519, ssh-rsa, ecdsa-sha2-* or a sk-* hardware key). The label defaults to the line's comment. The key is used nowhere until set_ssh_key_service puts it in a service. Fails for a private key, a line that is no public key, or a key the member already has.",
  kind: "mutation",
  input: z.object({
    public_key: z.string().trim().min(1, "請貼上公鑰").max(8192, "公鑰太長"),
    label: z.string().trim().max(60, "名稱最多 60 字").optional(),
  }),
  run: async (actor, input) => {
    if (input.public_key.includes("PRIVATE KEY"))
      throw new Error("這是私鑰，請貼上 .pub 檔的內容")
    const key = parsePublicKey(input.public_key)
    if (!key) throw new Error("這不是 SSH 公鑰，請貼上 .pub 檔的整行內容")
    const label = (input.label || key.comment || key.type).slice(0, 60)
    const [added] = await addKeys(actor, [{ ...key, label }], "paste")
    if (!added) throw new Error("這把金鑰已經加過了")
    return { id: added.id, fingerprint: added.fingerprint }
  },
})

export const importSshKeys = defineAction({
  name: "import_ssh_keys",
  title: "匯入 SSH 金鑰",
  description:
    "Adds to the signed-in member the public keys a Git host lists for one of its accounts (https://<host>/<username>.keys): host is github, gitlab or winlab-gitlab. Keys the member already has are skipped. Returns how many were added and how many were skipped. Delete the ones not wanted with delete_ssh_key.",
  kind: "mutation",
  input: z.object({
    host: z.enum(keyHostIds),
    username: z.string().trim().regex(hostUsername, "帳號格式不對"),
  }),
  run: async (actor, { host, username }) => {
    const found = await hostedKeys(host, username)
    if (found.length === 0)
      throw new Error(`${keyHosts[host].label} 的 ${username} 沒有公鑰`)
    const label = `${keyHosts[host].label} ${username}`.slice(0, 60)
    const added = await addKeys(
      actor,
      found.map((key) => ({ ...key, label })),
      host
    )
    return { added: added.length, skipped: found.length - added.length }
  },
})

export const deleteSshKey = defineAction({
  name: "delete_ssh_key",
  title: "刪除 SSH 金鑰",
  description:
    "Deletes one of the signed-in member's SSH keys by id (from list_my_ssh_keys). Every service stops serving it on its next read. Fails when the key is not the member's.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) =>
    db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(sshKeys)
        .where(and(eq(sshKeys.id, id), eq(sshKeys.userId, actor.userId)))
        .returning({ fingerprint: sshKeys.fingerprint })
      if (!deleted) throw new Error("找不到這把金鑰")
      await record(tx, actor, {
        action: "delete_key",
        userId: actor.userId,
        fingerprint: deleted.fingerprint,
      })
      return { deleted: true }
    }),
})

export const setSshKeyService = defineAction({
  name: "set_ssh_key_service",
  title: "設定金鑰用在哪個服務",
  description:
    "Puts one of the signed-in member's SSH keys in a service (used true) or takes it out (used false): id from list_my_ssh_keys, service a slug from its services list. The service's machines accept the key from their next read. Fails for a service the member may not use.",
  kind: "mutation",
  input: z.object({
    id: z.uuid(),
    service: z.string().trim().min(1).max(32),
    used: z.boolean(),
  }),
  run: async (actor, { id, service: slug, used }) =>
    db.transaction(async (tx) => {
      const [key] = await tx
        .select({ fingerprint: sshKeys.fingerprint })
        .from(sshKeys)
        .where(and(eq(sshKeys.id, id), eq(sshKeys.userId, actor.userId)))
      if (!key) throw new Error("找不到這把金鑰")
      const [service] = await tx
        .select({
          id: sshServices.id,
          open: sshServices.open,
          granted: sshServiceGrants.userId,
        })
        .from(sshServices)
        .leftJoin(
          sshServiceGrants,
          and(
            eq(sshServiceGrants.serviceId, sshServices.id),
            eq(sshServiceGrants.userId, actor.userId)
          )
        )
        .where(eq(sshServices.slug, slug))
      // A service the member may not use reads the same as one that does
      // not exist.
      if (!service || !(service.open || service.granted))
        throw new Error("你不能用這個服務")
      const changed = used
        ? await tx
            .insert(sshKeyServices)
            .values({ keyId: id, serviceId: service.id })
            .onConflictDoNothing()
            .returning({ keyId: sshKeyServices.keyId })
        : await tx
            .delete(sshKeyServices)
            .where(
              and(
                eq(sshKeyServices.keyId, id),
                eq(sshKeyServices.serviceId, service.id)
              )
            )
            .returning({ keyId: sshKeyServices.keyId })
      if (changed.length)
        await record(tx, actor, {
          action: used ? "use_key" : "unuse_key",
          userId: actor.userId,
          service: slug,
          fingerprint: key.fingerprint,
        })
      return { used }
    }),
})

export const listSshServices = defineAction({
  name: "list_ssh_services",
  title: "SSH 服務",
  description:
    "Portal admins only: every service that reads members' SSH keys, with id, slug, name, whether it is open to every current lab member, the first characters of its read key, when a machine last read it, how many keys are in it, and the members granted (for a service that is not open). Never the read key itself.",
  kind: "query",
  admin: "portal",
  input: z.object({}),
  run: async () => {
    const [services, grants, uses] = await Promise.all([
      db.select().from(sshServices).orderBy(asc(sshServices.name)),
      db
        .select({
          serviceId: sshServiceGrants.serviceId,
          userId: user.id,
          name: user.name,
        })
        .from(sshServiceGrants)
        .innerJoin(user, eq(user.id, sshServiceGrants.userId))
        .orderBy(asc(user.name)),
      db
        .select({ serviceId: sshKeyServices.serviceId, keys: count() })
        .from(sshKeyServices)
        .groupBy(sshKeyServices.serviceId),
    ])
    return {
      services: services.map((service) => ({
        id: service.id,
        slug: service.slug,
        name: service.name,
        open: service.open,
        prefix: service.prefix,
        createdAt: service.createdAt,
        lastReadAt: service.lastReadAt,
        keys: uses.find((use) => use.serviceId === service.id)?.keys ?? 0,
        grants: grants
          .filter((grant) => grant.serviceId === service.id)
          .map(({ userId, name }) => ({ userId, name })),
      })),
    }
  },
})

export const createSshService = defineAction({
  name: "create_ssh_service",
  title: "建立 SSH 服務",
  description:
    "Portal admins only: makes a service that reads members' SSH keys (a jump host, a platform) and returns its read key once; only the hash is kept. slug is its name in the URL its machines read. open true lets every current lab member use it; false only the members granted.",
  kind: "mutation",
  admin: "portal",
  mcpExcludedBecause:
    "the read key is shown once and lets a machine read who may log in; an admin makes it on /keys/services so it never passes through an agent's context",
  input: z.object({
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "代號只能用小寫英數與連字號"),
    name: z.string().trim().min(1, "請填名稱").max(60, "名稱最多 60 字"),
    open: z.boolean(),
  }),
  run: async (actor, { slug, name, open }) =>
    db.transaction(async (tx) => {
      const { token, tokenHash, prefix } = newToken()
      const [created] = await tx
        .insert(sshServices)
        .values({
          slug,
          name,
          open,
          tokenHash,
          prefix,
          createdBy: actor.userId,
        })
        .onConflictDoNothing({ target: sshServices.slug })
        .returning({ id: sshServices.id })
      if (!created) throw new Error("這個代號已經有服務在用")
      await record(tx, actor, { action: "create_service", service: slug })
      return { id: created.id, slug, token }
    }),
})

export const rotateSshServiceKey = defineAction({
  name: "rotate_ssh_service_key",
  title: "重發 SSH 服務的讀取金鑰",
  description:
    "Portal admins only: replaces a service's read key and returns the new one once. The old key stops working at once, so its machines read nothing until they hold the new one.",
  kind: "mutation",
  admin: "portal",
  mcpExcludedBecause:
    "the read key is shown once; an admin replaces it on /keys/services so it never passes through an agent's context",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) =>
    db.transaction(async (tx) => {
      const { token, tokenHash, prefix } = newToken()
      const [service] = await tx
        .update(sshServices)
        .set({ tokenHash, prefix, lastReadAt: null })
        .where(eq(sshServices.id, id))
        .returning({ slug: sshServices.slug })
      if (!service) throw new Error("找不到這個服務")
      await record(tx, actor, {
        action: "rotate_service",
        service: service.slug,
      })
      return { slug: service.slug, token }
    }),
})

export const deleteSshService = defineAction({
  name: "delete_ssh_service",
  title: "刪除 SSH 服務",
  description:
    "Portal admins only: deletes a service by id, with its grants and every key's use of it. Its read key stops working at once. Members' keys themselves stay.",
  kind: "mutation",
  admin: "portal",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) =>
    db.transaction(async (tx) => {
      const [service] = await tx
        .delete(sshServices)
        .where(eq(sshServices.id, id))
        .returning({ slug: sshServices.slug })
      if (!service) throw new Error("找不到這個服務")
      await record(tx, actor, {
        action: "delete_service",
        service: service.slug,
      })
      return { deleted: true }
    }),
})

export const grantSshService = defineAction({
  name: "grant_ssh_service",
  title: "讓成員使用 SSH 服務",
  description:
    "Portal admins only: lets one member (user_id from list_members) use a service that is not open, so they can put their keys in it. Fails for an open service, which every current lab member already uses.",
  kind: "mutation",
  admin: "portal",
  input: z.object({ id: z.uuid(), user_id: z.uuid() }),
  run: async (actor, { id, user_id }) =>
    db.transaction(async (tx) => {
      const [service] = await tx
        .select({ slug: sshServices.slug, open: sshServices.open })
        .from(sshServices)
        .where(eq(sshServices.id, id))
      if (!service) throw new Error("找不到這個服務")
      if (service.open) throw new Error("這個服務所有成員都能用")
      const [member] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, user_id))
      if (!member) throw new Error("找不到這個成員")
      const granted = await tx
        .insert(sshServiceGrants)
        .values({ serviceId: id, userId: user_id, grantedBy: actor.userId })
        .onConflictDoNothing()
        .returning({ userId: sshServiceGrants.userId })
      if (granted.length) {
        // A grant starts with none of the member's keys in the service: a
        // key put in while an earlier grant was being taken away would
        // otherwise come back with this one.
        await tx
          .delete(sshKeyServices)
          .where(
            and(
              eq(sshKeyServices.serviceId, id),
              sql`${sshKeyServices.keyId} in (select id from ssh_keys where user_id = ${user_id})`
            )
          )
        await record(tx, actor, {
          action: "grant",
          userId: user_id,
          service: service.slug,
        })
      }
      return { granted: true }
    }),
})

export const revokeSshServiceGrant = defineAction({
  name: "revoke_ssh_service_grant",
  title: "收回成員的 SSH 服務",
  description:
    "Portal admins only: takes a service away from one member. Their keys leave the service with the grant, and its machines stop accepting them on their next read. Fails when the member holds no grant.",
  kind: "mutation",
  admin: "portal",
  input: z.object({ id: z.uuid(), user_id: z.uuid() }),
  run: async (actor, { id, user_id }) =>
    db.transaction(async (tx) => {
      const [revoked] = await tx
        .delete(sshServiceGrants)
        .where(
          and(
            eq(sshServiceGrants.serviceId, id),
            eq(sshServiceGrants.userId, user_id)
          )
        )
        .returning({ serviceId: sshServiceGrants.serviceId })
      if (!revoked) throw new Error("這個成員沒有這個服務")
      // Their keys leave with the grant.
      await tx
        .delete(sshKeyServices)
        .where(
          and(
            eq(sshKeyServices.serviceId, id),
            sql`${sshKeyServices.keyId} in (select id from ssh_keys where user_id = ${user_id})`
          )
        )
      const [service] = await tx
        .select({ slug: sshServices.slug })
        .from(sshServices)
        .where(eq(sshServices.id, id))
      await record(tx, actor, {
        action: "revoke",
        userId: user_id,
        service: service?.slug,
      })
      return { revoked: true }
    }),
})

export const listSshKeyChanges = defineAction({
  name: "list_ssh_key_changes",
  title: "SSH 金鑰異動紀錄",
  description:
    "Portal admins only: the last 200 changes to who can log in where, newest first: when, who did it, the action (add_key, delete_key, use_key, unuse_key, create_service, delete_service, rotate_service, grant, revoke), the member it is about, the service slug and the key fingerprint.",
  kind: "query",
  admin: "portal",
  input: z.object({}),
  run: async () => {
    const actor = alias(user, "actor")
    const changes = await db
      .select({
        at: sshKeyChanges.at,
        actor: actor.name,
        action: sshKeyChanges.action,
        member: user.name,
        service: sshKeyChanges.service,
        fingerprint: sshKeyChanges.fingerprint,
      })
      .from(sshKeyChanges)
      .leftJoin(actor, eq(actor.id, sshKeyChanges.actorId))
      .leftJoin(user, eq(user.id, sshKeyChanges.userId))
      .orderBy(desc(sshKeyChanges.at))
      .limit(200)
    return { changes }
  },
})

/**
 * What a service's machines read: each member allowed in, with the keys
 * they put in the service. Not an action: the caller is a machine holding
 * the service's read key, with no session.
 *
 * Who is allowed is asked of Keycloak on every read (its directory is
 * cached for 10 minutes): the account must be enabled and a person; an open
 * service takes current lab members (not alumni), any other only the
 * members granted. Keycloak being unreachable throws, so a machine keeps
 * the last list it read instead of an empty one.
 */
export async function readServiceKeys(
  token: string,
  slug: string,
  username?: string
): Promise<
  { refused: 401 | 403 } | { members: { username: string; keys: string[] }[] }
> {
  if (!SERVICE_TOKEN.test(token)) return { refused: 401 }
  const [service] = await db
    .update(sshServices)
    .set({ lastReadAt: sql`now()` })
    .where(eq(sshServices.tokenHash, hash(token)))
    .returning({
      id: sshServices.id,
      slug: sshServices.slug,
      open: sshServices.open,
    })
  if (!service) return { refused: 401 }
  if (service.slug !== slug) return { refused: 403 }

  const [rows, accounts, directory] = await Promise.all([
    db
      .select({
        sub: account.accountId,
        type: sshKeys.type,
        blob: sshKeys.blob,
        granted: sshServiceGrants.userId,
      })
      .from(sshKeyServices)
      .innerJoin(sshKeys, eq(sshKeys.id, sshKeyServices.keyId))
      .innerJoin(
        account,
        and(
          eq(account.userId, sshKeys.userId),
          eq(account.providerId, "keycloak")
        )
      )
      .leftJoin(
        sshServiceGrants,
        and(
          eq(sshServiceGrants.serviceId, sshKeyServices.serviceId),
          eq(sshServiceGrants.userId, sshKeys.userId)
        )
      )
      .where(eq(sshKeyServices.serviceId, service.id))
      .orderBy(asc(sshKeys.createdAt)),
    realmAccounts(),
    labDirectory(),
  ])
  const usernames = new Map(
    accounts.map(({ id, username }) => [id, username.toLowerCase()])
  )
  const wanted = username?.toLowerCase()
  const members = new Map<string, string[]>()
  for (const row of rows) {
    const name = usernames.get(row.sub)
    if (!name || (wanted && name !== wanted)) continue
    const status = directory.get(row.sub)?.status
    const allowed = service.open
      ? !!status && status !== "alumni"
      : !!row.granted
    if (!allowed) continue
    members.set(name, [...(members.get(name) ?? []), line(row, name)])
  }
  return {
    members: [...members]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, keys]) => ({ username, keys })),
  }
}
