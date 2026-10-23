import { count, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin } from "@/lib/actions/authz"
import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { doorPlaylistItems, doorSounds, user } from "@/lib/db/schema"
import {
  PLAYLIST_MAX,
  SOUND_LABEL_MAX,
  SOUND_MAX_BYTES,
  SOUND_MAX_SECONDS,
  SOUND_UPLOADS_MAX,
  soundType,
} from "@/lib/door-greeting"

const id = z.uuid("找不到這個音效")
const label = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "請填名稱")
      .refine(
        (value) => [...value].length <= SOUND_LABEL_MAX,
        `名稱最多 ${SOUND_LABEL_MAX} 個字`
      )
  )

const audio = z
  .base64("檔案要是 base64")
  .max(Math.ceil((SOUND_MAX_BYTES * 4) / 3) + 4, "音檔超過 3 MB")

/** The bytes of an uploaded sound and the audio type they say, or why
 * they are refused. */
function decodeSound(base64: string) {
  const sound = Buffer.from(base64, "base64")
  if (!sound.length) throw new Error("音檔是空的")
  if (sound.length > SOUND_MAX_BYTES) throw new Error("音檔超過 3 MB")
  const type = soundType(sound)
  if (!type) throw new Error("只接受 mp3、m4a、aac、wav、ogg 音檔")
  return { sound, type }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** One upload or playlist change at a time per member, so the caps hold
 * and a playlist is replaced, never merged. */
async function lockMember(tx: Tx, userId: string) {
  await tx.execute(
    sql`select 1 from ${user} where ${user.id} = ${userId} for update`
  )
}

/** The sound, if the actor may change it: its uploader or a door admin. */
async function ownSound(actor: Actor, soundId: string) {
  const [row] = await db
    .select({ uploaderId: doorSounds.uploaderId })
    .from(doorSounds)
    .where(eq(doorSounds.id, soundId))
  if (!row) throw new Error("找不到這個音效")
  if (row.uploaderId !== actor.userId && !(await isAdmin(actor, "door")))
    throw new Error("只有上傳的人或 Door 管理員能改")
}

export type DoorSound = {
  id: string
  version: string
  label: string
  uploader: string | null
  mine: boolean
  isDefault: boolean
  onMyPlaylist: boolean
  listeners: number
  createdAt: Date
}

export const listDoorSounds = defineAction({
  name: "list_door_sounds",
  title: "門口音效池",
  description:
    "Every sound in the lab's door sound pool, newest first: label, uploader, whether it is a default (played for members with an empty playlist), whether it is on the signed-in member's playlist, and how many members have it on theirs. can_edit_all says whether the member is a door admin, who may rename, delete and mark defaults on any sound; uploaders may rename and delete their own.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const listeners = db
      .select({ soundId: doorPlaylistItems.soundId, n: count().as("n") })
      .from(doorPlaylistItems)
      .groupBy(doorPlaylistItems.soundId)
      .as("listeners")
    const [rows, mine, admin] = await Promise.all([
      db
        .select({
          id: doorSounds.id,
          version: doorSounds.version,
          label: doorSounds.label,
          uploaderId: doorSounds.uploaderId,
          uploader: user.name,
          isDefault: doorSounds.isDefault,
          listeners: listeners.n,
          createdAt: doorSounds.createdAt,
        })
        .from(doorSounds)
        .leftJoin(user, eq(user.id, doorSounds.uploaderId))
        .leftJoin(listeners, eq(listeners.soundId, doorSounds.id))
        .orderBy(desc(doorSounds.createdAt)),
      db
        .select({ soundId: doorPlaylistItems.soundId })
        .from(doorPlaylistItems)
        .where(eq(doorPlaylistItems.userId, actor.userId)),
      isAdmin(actor, "door"),
    ])
    const playlist = new Set(mine.map((row) => row.soundId))
    return {
      sounds: rows.map((row): DoorSound => ({
        id: row.id,
        version: row.version,
        label: row.label,
        uploader: row.uploader,
        mine: row.uploaderId === actor.userId,
        isDefault: row.isDefault,
        onMyPlaylist: playlist.has(row.id),
        listeners: Number(row.listeners ?? 0),
        createdAt: row.createdAt,
      })),
      can_edit_all: admin,
    }
  },
})

export const getDoorSound = defineAction({
  name: "get_door_sound",
  title: "試聽門口音效",
  description:
    "One sound from the door sound pool as base64 with its content type and version (it changes when the file is replaced), to listen to it.",
  kind: "query",
  input: z.object({ id }),
  run: async (_actor, { id: soundId }) => {
    const [row] = await db
      .select({
        sound: doorSounds.sound,
        type: doorSounds.soundType,
        version: doorSounds.version,
      })
      .from(doorSounds)
      .where(eq(doorSounds.id, soundId))
    if (!row) throw new Error("找不到這個音效")
    return {
      contentType: row.type,
      version: row.version,
      base64: row.sound.toString("base64"),
    }
  },
})

export const uploadDoorSound = defineAction({
  name: "upload_door_sound",
  refreshesDoorPanel: true,
  title: "上傳門口音效",
  description: `Adds a sound to the lab's door sound pool as base64 (mp3, m4a, aac, wav or ogg, up to ${SOUND_MAX_BYTES / 1024 / 1024} MB; the door plays its first ${SOUND_MAX_SECONDS} seconds) with a label, and puts it on the signed-in member's playlist. A member can have ${SOUND_UPLOADS_MAX} sounds in the pool.`,
  kind: "mutation",
  input: z.object({ label, base64: audio }),
  run: async (actor, input) => {
    const { sound, type } = decodeSound(input.base64)
    return db.transaction(async (tx) => {
      await lockMember(tx, actor.userId)
      const [{ n }] = await tx
        .select({ n: count() })
        .from(doorSounds)
        .where(eq(doorSounds.uploaderId, actor.userId))
      if (n >= SOUND_UPLOADS_MAX)
        throw new Error(`每人最多 ${SOUND_UPLOADS_MAX} 個音效，先刪一個`)
      const [{ n: listed }] = await tx
        .select({ n: count() })
        .from(doorPlaylistItems)
        .where(eq(doorPlaylistItems.userId, actor.userId))
      const [row] = await tx
        .insert(doorSounds)
        .values({
          label: input.label,
          uploaderId: actor.userId,
          sound,
          soundType: type,
        })
        .returning({ id: doorSounds.id })
      if (listed < PLAYLIST_MAX)
        await tx
          .insert(doorPlaylistItems)
          .values({ userId: actor.userId, soundId: row.id })
      return { id: row.id, on_my_playlist: listed < PLAYLIST_MAX }
    })
  },
})

export const renameDoorSound = defineAction({
  name: "rename_door_sound",
  refreshesDoorPanel: true,
  title: "改門口音效名稱",
  description:
    "Renames a sound in the door sound pool. Only its uploader or a door admin may.",
  kind: "mutation",
  input: z.object({ id, label }),
  run: async (actor, input) => {
    await ownSound(actor, input.id)
    await db
      .update(doorSounds)
      .set({ label: input.label })
      .where(eq(doorSounds.id, input.id))
    return { id: input.id, label: input.label }
  },
})

export const replaceDoorSound = defineAction({
  name: "replace_door_sound",
  refreshesDoorPanel: true,
  title: "換門口音效的音檔",
  description: `Replaces the audio file of a sound in the door sound pool with new base64 audio (same formats and ${SOUND_MAX_BYTES / 1024 / 1024} MB limit as upload_door_sound). The sound keeps its id, label, default mark and every playlist it is on, so every member who has it hears the new file from the next door open. Only its uploader or a door admin may.`,
  kind: "mutation",
  input: z.object({ id, base64: audio }),
  run: async (actor, input) => {
    const { sound, type } = decodeSound(input.base64)
    await ownSound(actor, input.id)
    const [row] = await db
      .update(doorSounds)
      .set({ sound, soundType: type, version: crypto.randomUUID() })
      .where(eq(doorSounds.id, input.id))
      .returning({ id: doorSounds.id, version: doorSounds.version })
    if (!row) throw new Error("找不到這個音效")
    return row
  },
})

export const deleteDoorSound = defineAction({
  name: "delete_door_sound",
  refreshesDoorPanel: true,
  title: "刪除門口音效",
  description:
    "Deletes a sound from the door sound pool and from every playlist it is on. Only its uploader or a door admin may.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, input) => {
    await ownSound(actor, input.id)
    await db.delete(doorSounds).where(eq(doorSounds.id, input.id))
    return { deleted: true }
  },
})

export const setDoorPlaylist = defineAction({
  name: "set_door_playlist",
  refreshesDoorPanel: true,
  title: "設定我的開門清單",
  description: `Replaces the signed-in member's door playlist with these pool sounds (at most ${PLAYLIST_MAX}). The door plays one of them at random each time they come in, so a playlist of one always plays that sound; an empty playlist plays one of the lab's defaults. Use list_door_sounds for the ids.`,
  kind: "mutation",
  input: z.object({
    sound_ids: z
      .array(id)
      .max(PLAYLIST_MAX, `清單最多 ${PLAYLIST_MAX} 個`)
      .refine((ids) => new Set(ids).size === ids.length, "清單裡有重複的音效"),
  }),
  run: async (actor, { sound_ids }) =>
    db.transaction(async (tx) => {
      await lockMember(tx, actor.userId)
      if (sound_ids.length) {
        const found = await tx
          .select({ id: doorSounds.id })
          .from(doorSounds)
          .where(inArray(doorSounds.id, sound_ids))
        if (found.length !== sound_ids.length)
          throw new Error("有音效已經被刪掉了")
      }
      await tx
        .delete(doorPlaylistItems)
        .where(eq(doorPlaylistItems.userId, actor.userId))
      if (sound_ids.length)
        await tx.insert(doorPlaylistItems).values(
          // A millisecond apart, so the playlist reads back in this order.
          sound_ids.map((soundId, i) => ({
            userId: actor.userId,
            soundId,
            createdAt: new Date(Date.now() + i),
          }))
        )
      return { sound_ids }
    }),
})

export const setDoorSoundDefault = defineAction({
  name: "set_door_sound_default",
  refreshesDoorPanel: true,
  title: "設定預設門口音效",
  description:
    "Marks a pool sound as one of the lab's defaults, played at random for members with an empty playlist, or unmarks it. Door admins only.",
  kind: "mutation",
  input: z.object({ id, is_default: z.boolean() }),
  run: async (actor, input) => {
    if (!(await isAdmin(actor, "door"))) throw new Error("需要 Door 管理員權限")
    const updated = await db
      .update(doorSounds)
      .set({ isDefault: input.is_default })
      .where(eq(doorSounds.id, input.id))
      .returning({ id: doorSounds.id })
    if (!updated.length) throw new Error("找不到這個音效")
    return { id: input.id, is_default: input.is_default }
  },
})

// What the door panel reads (not an action: the panel is a machine with its
// own secret, /api/door/sounds/<id>).

/** A pool sound's bytes, or null once it is deleted. */
export async function panelSound(soundId: string) {
  const [row] = await db
    .select({ sound: doorSounds.sound, type: doorSounds.soundType })
    .from(doorSounds)
    .where(eq(doorSounds.id, soundId))
  return row ? { bytes: row.sound, type: row.type } : null
}

/** Every playlist, by member, the defaults and each sound's version: what
 * the panel plays. */
export async function panelPlaylists() {
  const [items, defaults, versions] = await Promise.all([
    db
      .select({
        userId: doorPlaylistItems.userId,
        soundId: doorPlaylistItems.soundId,
      })
      .from(doorPlaylistItems)
      .orderBy(doorPlaylistItems.userId, doorPlaylistItems.createdAt),
    db
      .select({ id: doorSounds.id })
      .from(doorSounds)
      .where(eq(doorSounds.isDefault, true))
      .orderBy(doorSounds.createdAt),
    db
      .select({ id: doorSounds.id, version: doorSounds.version })
      .from(doorSounds),
  ])
  const playlists = new Map<string, string[]>()
  for (const item of items)
    playlists.set(item.userId, [
      ...(playlists.get(item.userId) ?? []),
      item.soundId,
    ])
  return {
    playlists,
    defaults: defaults.map((row) => row.id),
    versions: new Map(versions.map((row) => [row.id, row.version])),
  }
}
