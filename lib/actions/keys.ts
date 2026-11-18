import { createHash, randomBytes } from "node:crypto"

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  account,
  sshKeyChanges,
  sshKeys,
  sshKeyServices,
  sshServiceChoices,
  sshServiceGrants,
  sshServices,
  user,
} from "@/lib/db/schema"
import {
  findKeycloakUser,
  getKeycloakUserGroupPaths,
  labStatuses,
  labDirectory,
  realmAccounts,
} from "@/lib/keycloak"
import {
  hostedKeys,
  hostUsername,
  keyHostIds,
  keyHosts,
  type ParsedKey,
  parsePublicKey,
} from "@/lib/ssh-keys"

// SSH keys: a member keeps their public keys here; a service's machines
// read each member's keys with the service's read key (readServiceKeys,
// behind /api/ssh-keys): the keys the member turned on for that service,
// one for each machine they log in from. A member who never chose for a
// service is read their first key; one who chose is read exactly the keys
// that are on, so deleting the last of them leaves the service none. Portal admins make the services
// and, for one that is not open, name who may use it.
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

/** One member's key changes run one at a time (until the transaction ends). */
const lockKeys = (tx: Tx, userId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`ssh_keys:${userId}`}))`
  )

const record = (tx: Tx, actor: Actor, change: Change) =>
  tx.insert(sshKeyChanges).values({ actorId: actor.userId, ...change })

/** The line a machine puts in authorized_keys: the key and whose it is. */
const line = (key: { type: string; blob: string }, username: string) =>
  `${key.type} ${key.blob} ${username}`

// The one order of a member's keys: an import adds several in one statement
// with one created_at, so the id settles which is first. The page and the
// machine read must agree on the first key.
const oldestFirst = [asc(sshKeys.createdAt), asc(sshKeys.id)] as const

const machineInput = z.string().trim().max(60, "機器最多 60 字")
const descriptionInput = z.string().trim().max(200, "用途最多 200 字")
type KeyNotes = { label: string; machine?: string; description?: string }

async function addKeys(
  actor: Actor,
  keys: (ParsedKey & KeyNotes)[],
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
              machine: key.machine || null,
              description: key.description || null,
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
    "The signed-in member's SSH public keys (id, label, the machine that holds the private key, what the key is for, type, fingerprint, the public key line, where it came from, when it was added, and the slugs of the services that use it), the member's name and account username, and the services the member may use (slug, name, keyIds, the ids of the keys that service uses, and keyId, the first of them). A service uses the keys the member turned on with set_ssh_service_key. Until the member turns a key on or off for a service it uses their first key; after that it uses exactly the keys that are on, so keyIds can be empty and keyId null.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [[owner], keys, uses, chosen, services] = await Promise.all([
      db
        .select({ username: user.username, name: user.name })
        .from(user)
        .where(eq(user.id, actor.userId)),
      db
        .select()
        .from(sshKeys)
        .where(eq(sshKeys.userId, actor.userId))
        .orderBy(...oldestFirst),
      db
        .select({ keyId: sshKeyServices.keyId, slug: sshServices.slug })
        .from(sshKeyServices)
        .innerJoin(sshKeys, eq(sshKeys.id, sshKeyServices.keyId))
        .innerJoin(sshServices, eq(sshServices.id, sshKeyServices.serviceId))
        .where(eq(sshKeys.userId, actor.userId)),
      db
        .select({ slug: sshServices.slug })
        .from(sshServiceChoices)
        .innerJoin(sshServices, eq(sshServices.id, sshServiceChoices.serviceId))
        .where(eq(sshServiceChoices.userId, actor.userId)),
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
    // A service uses the keys that are on for it; one the member never
    // chose for uses the first key. keys is oldest first, so keyIds comes
    // out in that order too.
    const used = services.map((service) => {
      const picked = new Set(
        uses.filter((use) => use.slug === service.slug).map((use) => use.keyId)
      )
      const chose =
        picked.size > 0 || chosen.some((one) => one.slug === service.slug)
      const keyIds = keys
        .filter((key, index) => (chose ? picked.has(key.id) : index === 0))
        .map((key) => key.id)
      // keyId is the first of keyIds, kept for clients written when a
      // service used one key.
      return { ...service, keyId: keyIds[0] ?? null, keyIds }
    })
    return {
      username: owner?.username ?? null,
      name: owner?.name ?? null,
      keys: keys.map((key) => ({
        id: key.id,
        label: key.label,
        machine: key.machine,
        description: key.description,
        type: key.type,
        fingerprint: key.fingerprint,
        publicKey: `${key.type} ${key.blob}`,
        source: key.source,
        createdAt: key.createdAt,
        services: used
          .filter((service) => service.keyIds.includes(key.id))
          .map((service) => service.slug),
      })),
      services: used,
    }
  },
})

export const listMemberSshKeys = defineAction({
  name: "list_member_ssh_keys",
  title: "成員的 SSH 公鑰",
  description:
    "Every SSH public key one lab member keeps on the portal, by their account username. keys is one authorized_keys line each (type, key, username); details says for each, in the same order, its label, the machine that holds the private key, what the member says it is for, and its fingerprint. Use it to let a member into a machine you run, picking the key by machine and purpose. Fails when no member has that username.",
  kind: "query",
  input: z.object({ username: z.string().trim().min(1).max(64) }),
  run: async (_actor, { username }) => {
    const [member] = await db
      .select({ id: user.id, username: user.username, name: user.name })
      .from(user)
      .where(sql`lower(${user.username}) = ${username.toLowerCase()}`)
    if (!member?.username) throw new Error("找不到這個成員")
    const keys = await db
      .select({
        type: sshKeys.type,
        blob: sshKeys.blob,
        label: sshKeys.label,
        machine: sshKeys.machine,
        description: sshKeys.description,
        fingerprint: sshKeys.fingerprint,
      })
      .from(sshKeys)
      .where(eq(sshKeys.userId, member.id))
      .orderBy(...oldestFirst)
    return {
      username: member.username,
      name: member.name,
      keys: keys.map((key) => line(key, member.username!)),
      details: keys.map((key) => ({
        label: key.label,
        machine: key.machine,
        description: key.description,
        fingerprint: key.fingerprint,
      })),
    }
  },
})

export const listSshKeyMembers = defineAction({
  name: "list_ssh_key_members",
  title: "有 SSH 公鑰的成員",
  description:
    "Every lab member who keeps SSH public keys on the portal, by name, each with their keys oldest first: line is one authorized_keys line (type, key, username), beside its label, the machine that holds the private key, what the member says it is for, and its fingerprint. Use it to find whose key to put on a machine you open for them; list_member_ssh_keys reads one member by username.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const rows = await db
      .select({
        username: user.username,
        name: user.name,
        type: sshKeys.type,
        blob: sshKeys.blob,
        label: sshKeys.label,
        machine: sshKeys.machine,
        description: sshKeys.description,
        fingerprint: sshKeys.fingerprint,
      })
      .from(sshKeys)
      .innerJoin(user, eq(user.id, sshKeys.userId))
      .orderBy(asc(user.name), asc(user.id), ...oldestFirst)
    const members: {
      username: string
      name: string
      keys: {
        line: string
        label: string
        machine: string | null
        description: string | null
        type: string
        fingerprint: string
      }[]
    }[] = []
    for (const row of rows) {
      // A key is served under the account's username; an account without
      // one has no line to give.
      if (!row.username) continue
      let member = members.at(-1)
      if (member?.username !== row.username) {
        member = { username: row.username, name: row.name, keys: [] }
        members.push(member)
      }
      member.keys.push({
        line: line(row, row.username),
        label: row.label,
        machine: row.machine,
        description: row.description,
        type: row.type,
        fingerprint: row.fingerprint,
      })
    }
    return { members }
  },
})

export const addSshKey = defineAction({
  name: "add_ssh_key",
  title: "新增 SSH 金鑰",
  description:
    "Adds one SSH public key to the signed-in member: the whole line of a .pub file (ssh-ed25519, ssh-rsa, ecdsa-sha2-* or a sk-* hardware key). The label defaults to the line's comment; machine names the computer that holds the private key and description says what the key is for, both shown to members who read this member's keys. A member's first key is the one every service they may use reads, until set_ssh_service_key picks another for a service. Fails for a private key, a line that is no public key, or a key the member already has.",
  kind: "mutation",
  input: z.object({
    public_key: z.string().trim().min(1, "請貼上公鑰").max(8192, "公鑰太長"),
    label: z.string().trim().max(60, "名稱最多 60 字").optional(),
    machine: machineInput.optional(),
    description: descriptionInput.optional(),
  }),
  run: async (actor, input) => {
    if (input.public_key.includes("PRIVATE KEY"))
      throw new Error("這是私鑰，請貼上 .pub 檔的內容")
    const key = parsePublicKey(input.public_key)
    if (!key) throw new Error("這不是 SSH 公鑰，請貼上 .pub 檔的整行內容")
    const label = (input.label || key.comment || key.type).slice(0, 60)
    const [added] = await addKeys(
      actor,
      [
        {
          ...key,
          label,
          machine: input.machine,
          description: input.description,
        },
      ],
      "paste"
    )
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

export const updateSshKey = defineAction({
  name: "update_ssh_key",
  title: "修改 SSH 金鑰的說明",
  description:
    "Changes what one of the signed-in member's SSH keys says about itself, by id (from list_my_ssh_keys): its label, the machine that holds the private key, and what the key is for. A field left out stays; an empty machine or description clears it. The key itself and the services it is used in do not change. Fails when the key is not the member's.",
  kind: "mutation",
  input: z.object({
    id: z.uuid(),
    label: z
      .string()
      .trim()
      .min(1, "請填名稱")
      .max(60, "名稱最多 60 字")
      .optional(),
    machine: machineInput.optional(),
    description: descriptionInput.optional(),
  }),
  run: async (actor, { id, label, machine, description }) => {
    const [updated] = await db
      .update(sshKeys)
      .set({
        // Never an empty set: an update with nothing to change still
        // answers whether the key is the member's.
        id,
        ...(label !== undefined && { label }),
        ...(machine !== undefined && { machine: machine || null }),
        ...(description !== undefined && {
          description: description || null,
        }),
      })
      .where(and(eq(sshKeys.id, id), eq(sshKeys.userId, actor.userId)))
      .returning({ id: sshKeys.id })
    if (!updated) throw new Error("找不到這把金鑰")
    return { updated: true }
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
      await lockKeys(tx, actor.userId)
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

export const setSshServiceKey = defineAction({
  name: "set_ssh_service_key",
  title: "設定服務用不用這把金鑰",
  description:
    "Turns one of the signed-in member's SSH keys on or off for a service: service is a slug from list_my_ssh_keys' services, id one of the member's keys, used true (the default) to let the service's machines accept it and false to stop. A service can use several keys, one for each machine the member logs in from; its machines read the change on their next read. A service that was only using the member's first key by default keeps it when another key is turned on. Once a member has turned a key on or off, the service uses exactly the keys that are on: turning the last one off, or deleting it, leaves the service with none of the member's keys until one is turned on again. Fails for a service the member may not use or a key that is not the member's. Returns keyIds, the keys the service uses now.",
  kind: "mutation",
  input: z.object({
    service: z.string().trim().min(1).max(32),
    id: z.uuid(),
    used: z.boolean().default(true),
  }),
  run: async (actor, { id, service: slug, used }) =>
    db.transaction(async (tx) => {
      // A member's key changes run one at a time: the keys read below are
      // the keys this change is decided on, whatever another tab is doing.
      await lockKeys(tx, actor.userId)
      const mine = await tx
        .select({ id: sshKeys.id, fingerprint: sshKeys.fingerprint })
        .from(sshKeys)
        .where(eq(sshKeys.userId, actor.userId))
        .orderBy(...oldestFirst)
      const key = mine.find((one) => one.id === id)
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
      const rows = await tx
        .select({ keyId: sshKeyServices.keyId })
        .from(sshKeyServices)
        .where(
          and(
            eq(sshKeyServices.serviceId, service.id),
            inArray(
              sshKeyServices.keyId,
              mine.map((one) => one.id)
            )
          )
        )
      const picked = new Set(rows.map((row) => row.keyId))
      const chose = await tx
        .insert(sshServiceChoices)
        .values({ serviceId: service.id, userId: actor.userId })
        .onConflictDoNothing()
        .returning({ userId: sshServiceChoices.userId })
      // Until now the service used the first key by default. Write that
      // down before changing anything, so turning a second key on adds to
      // the first instead of replacing it.
      if (chose.length > 0 && picked.size === 0) {
        await tx
          .insert(sshKeyServices)
          .values({ keyId: mine[0].id, serviceId: service.id })
        picked.add(mine[0].id)
      }
      if (used && !picked.has(id)) {
        await tx
          .insert(sshKeyServices)
          .values({ keyId: id, serviceId: service.id })
        picked.add(id)
        await record(tx, actor, {
          action: "use_key",
          userId: actor.userId,
          service: slug,
          fingerprint: key.fingerprint,
        })
      }
      if (!used && picked.has(id)) {
        await tx
          .delete(sshKeyServices)
          .where(
            and(
              eq(sshKeyServices.serviceId, service.id),
              eq(sshKeyServices.keyId, id)
            )
          )
        picked.delete(id)
        await record(tx, actor, {
          action: "unuse_key",
          userId: actor.userId,
          service: slug,
          fingerprint: key.fingerprint,
        })
      }
      return {
        service: slug,
        keyIds: mine.filter((one) => picked.has(one.id)).map((one) => one.id),
      }
    }),
})

export const listSshServices = defineAction({
  name: "list_ssh_services",
  title: "SSH 服務",
  description:
    "Portal admins only: every service that reads members' SSH keys, with id, slug, name, whether it is open to every current lab member, the first characters of its read key, when a machine last read it, and the members granted (for a service that is not open). Never the read key itself.",
  kind: "query",
  admin: "portal",
  input: z.object({}),
  run: async () => {
    const [services, grants] = await Promise.all([
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
      await lockKeys(tx, user_id)
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
        // otherwise come back with this one. A member who chose before
        // stays chosen, so a key they turned off does not come back as the
        // default either: they turn one on again themselves.
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
      await lockKeys(tx, user_id)
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
 * they turned on for the service. A member who never chose is read their
 * first key; one who chose and has none on is left out.
 * Not an action: the caller is a machine holding
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
        pickedAt: sshKeyServices.createdAt,
        chosenAt: sshServiceChoices.createdAt,
        granted: sshServiceGrants.userId,
      })
      .from(sshKeys)
      .innerJoin(
        account,
        and(
          eq(account.userId, sshKeys.userId),
          eq(account.providerId, "keycloak")
        )
      )
      .leftJoin(
        sshKeyServices,
        and(
          eq(sshKeyServices.keyId, sshKeys.id),
          eq(sshKeyServices.serviceId, service.id)
        )
      )
      .leftJoin(
        sshServiceChoices,
        and(
          eq(sshServiceChoices.serviceId, service.id),
          eq(sshServiceChoices.userId, sshKeys.userId)
        )
      )
      .leftJoin(
        sshServiceGrants,
        and(
          eq(sshServiceGrants.serviceId, service.id),
          eq(sshServiceGrants.userId, sshKeys.userId)
        )
      )
      .orderBy(...oldestFirst),
    realmAccounts(),
    labDirectory(),
  ])
  const usernames = new Map(
    accounts.map(({ id, username }) => [id, username.toLowerCase()])
  )
  const wanted = username?.toLowerCase()
  // Rows come oldest key first, so a member's first row is their first key
  // and the keys that are on keep that order. A member who chose is read
  // exactly those keys; one who has none on is left out.
  const members = new Map<
    string,
    { first: string; chose: boolean; picked: string[] }
  >()
  for (const row of rows) {
    const name = usernames.get(row.sub)
    if (!name || (wanted && name !== wanted)) continue
    const status = directory.get(row.sub)?.status
    const allowed = service.open
      ? !!status && status !== "alumni"
      : !!row.granted
    if (!allowed) continue
    const member = members.get(name) ?? {
      first: line(row, name),
      chose: !!row.chosenAt,
      picked: [],
    }
    if (row.pickedAt) member.picked.push(line(row, name))
    members.set(name, member)
  }
  return {
    members: [...members]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, { first, chose, picked }]) => ({
        username,
        keys: chose || picked.length > 0 ? picked : [first],
      }))
      .filter((member) => member.keys.length > 0),
  }
}

/**
 * The service principals for a member's SSH certificate, asked by the lab CA
 * (ca.winlab.tw) through its webhook while it signs. Not an action: the
 * caller is the CA, which cannot authenticate itself (step-ca loads no
 * webhook secret from its config), and the email comes from the request the
 * member sent. The answer carries a hash of the Keycloak account id it
 * found; the CA refuses unless it matches the member's signed token, so a
 * stale or wrong email lookup signs nothing.
 *
 * Same rule as readServiceKeys: the account must be enabled and a person;
 * an open service takes current lab members (not alumni), any other only
 * the members granted. Keys play no part: a certificate replaces them. An
 * account allowed in no service gets a certificate only as a current lab
 * member. Keycloak being unreachable throws, so the CA signs nothing.
 *
 * With forCA (the call that leads to a signature), the account and its
 * groups are read live instead of from the 10-minute caches: a disabled
 * account, a changed email or username, a /system account or a member who
 * just left gets nothing at once. Only then do a current member's Keycloak
 * groups /winlab-projects/<name> come back as projects: anyone else could
 * ask which projects an email is in.
 */
export async function readCertificatePrincipals(
  email: string,
  { forCA = false }: { forCA?: boolean } = {}
): Promise<
  | { member: false }
  | {
      member: true
      subject: string
      username: string
      services: string[]
      projects: string[]
    }
> {
  const wanted = email.toLowerCase()
  const [accounts, directory] = await Promise.all([
    realmAccounts(),
    labDirectory(),
  ])
  const matches = accounts.filter((a) => a.email?.toLowerCase() === wanted)
  if (matches.length !== 1) return { member: false }
  const [{ id: sub, username }] = matches
  const status = directory.get(sub)?.status
  let current = !!status && status !== "alumni"
  let paths: string[] = []
  if (forCA) {
    const [live, livePaths] = await Promise.all([
      findKeycloakUser(sub),
      getKeycloakUserGroupPaths(sub),
    ])
    if (
      live?.enabled !== true ||
      live.email?.toLowerCase() !== wanted ||
      live.username.toLowerCase() !== username.toLowerCase() ||
      livePaths.includes("/system")
    )
      return { member: false }
    paths = livePaths
    current = paths.some((path) => {
      const status = LAB_STATUS_GROUP.exec(path)?.[1]
      return !!status && status !== "alumni" && isLabStatus(status)
    })
  }

  const [member] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.accountId, sub), eq(account.providerId, "keycloak")))
  const granted = sql`${sshServiceGrants.userId} is not null`
  const services = await db
    .select({ slug: sshServices.slug })
    .from(sshServices)
    .leftJoin(
      sshServiceGrants,
      and(
        eq(sshServiceGrants.serviceId, sshServices.id),
        eq(sshServiceGrants.userId, member?.userId ?? sql`null`)
      )
    )
    .where(current ? sql`${sshServices.open} or ${granted}` : granted)
    .orderBy(asc(sshServices.slug))
  if (!current && services.length === 0) return { member: false }
  // Carrel project tenants: a current member of /winlab-projects/<name> may
  // log in to that project's machines. paths is empty unless forCA. Names
  // outside the CA's pattern are left out rather than passed on.
  const projects = current
    ? paths.flatMap((path) => {
        const name = PROJECT_GROUP.exec(path)?.[1]
        return name ? [name] : []
      })
    : []
  return {
    member: true,
    subject: createHash("sha256").update(sub).digest("hex"),
    username: username.toLowerCase(),
    services: services.map((s) => s.slug),
    projects: [...new Set(projects)].sort(),
  }
}

const PROJECT_GROUP = /^\/winlab-projects\/([a-z0-9][a-z0-9-]{0,62})$/
const LAB_STATUS_GROUP = /^\/lab-member\/([a-z]+)$/
const isLabStatus = (name: string) =>
  (labStatuses as readonly string[]).includes(name)
