import { and, asc, count, desc, eq, sql, sum } from "drizzle-orm"
import { zipSync } from "fflate"
import { PDFDocument } from "pdf-lib"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { tripFiles, trips, user } from "@/lib/db/schema"

const id = z.uuid("id 格式不對")

/** Largest file accepted, in bytes. */
export const TRIP_FILE_LIMIT = 10 * 1024 * 1024
const uploadTypes = ["application/pdf", "image/jpeg", "image/png"] as const

const description = z
  .string()
  .trim()
  .max(200, "說明最多 200 字")
  .nullish()
  .transform((text) => text || null)

async function findTrip(tripId: string) {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
  if (!trip) throw new Error("找不到這趟出差")
  return trip
}

/** The file's row without its bytes, and whether the actor may touch it. */
async function findFile(actor: Actor, fileId: string) {
  const [file] = await db
    .select({
      id: tripFiles.id,
      tripId: tripFiles.tripId,
      userId: tripFiles.userId,
      filename: tripFiles.filename,
      status: trips.status,
    })
    .from(tripFiles)
    .innerJoin(trips, eq(trips.id, tripFiles.tripId))
    .where(eq(tripFiles.id, fileId))
  const admin = await isAdmin(actor, "trip")
  // Someone else's file is not found, rather than forbidden, so ids leak
  // nothing.
  if (!file || (file.userId !== actor.userId && !admin))
    throw new Error("找不到這個檔案")
  return { file, admin, mine: file.userId === actor.userId }
}

/** "東京 收據.pdf" from whatever the member's file was called. */
function pdfName(name: string) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
  return `${(base || "file").slice(0, 120)}.pdf`
}

/** Most pixels an uploaded image may have: a 2000 px photo is 4 million,
 * a 600 dpi A4 scan about 35 million. Decoding is width x height x 4
 * bytes, so a tiny PNG claiming 30000 x 30000 would take gigabytes. */
const MAX_PIXELS = 40_000_000

/** Width and height from a PNG's IHDR, read before anything decodes it. */
function pngSize(data: Buffer) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  if (data.length < 24 || !data.subarray(0, 8).equals(signature))
    throw new Error("這不是 PNG 檔")
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function checkPixels({ width, height }: { width: number; height: number }) {
  if (width * height > MAX_PIXELS)
    throw new Error(`圖片太大(${width} × ${height})，請縮小後再傳`)
}

/** The uploaded bytes as a PDF: PDFs are checked, images wrapped on a page. */
async function toPdf(contentType: (typeof uploadTypes)[number], data: Buffer) {
  if (contentType === "application/pdf") {
    if (!data.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("這不是 PDF 檔")
    await PDFDocument.load(data, { updateMetadata: false }).catch(() => {
      throw new Error("PDF 打不開，可能已損毀或有密碼")
    })
    return data
  }
  // PNGs are measured before pdf-lib decodes them; JPEGs are only parsed
  // for their header and kept compressed, then measured the same way.
  if (contentType === "image/png") checkPixels(pngSize(data))
  const pdf = await PDFDocument.create()
  const image =
    contentType === "image/png"
      ? await pdf.embedPng(data)
      : await pdf.embedJpg(data)
  checkPixels(image)
  const page = pdf.addPage([image.width, image.height])
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  })
  return Buffer.from(await pdf.save())
}

export const listTrips = defineAction({
  name: "list_trips",
  title: "出差",
  description:
    "Business trips, open ones first then newest: id, name, description, status (open takes uploads, closed does not), how many files the signed-in member uploaded, and for trip admins how many people and files in all. Every member sees every trip; files are their own unless they are a trip admin.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const admin = await isAdmin(actor, "trip")
    const rows = await db
      .select({
        id: trips.id,
        name: trips.name,
        description: trips.description,
        status: trips.status,
        createdAt: trips.createdAt,
        closedAt: trips.closedAt,
        mine: sql<number>`count(${tripFiles.id}) filter (where ${tripFiles.userId} = ${actor.userId})`.mapWith(
          Number
        ),
        files: count(tripFiles.id),
        people: sql<number>`count(distinct ${tripFiles.userId})`.mapWith(
          Number
        ),
      })
      .from(trips)
      .leftJoin(tripFiles, eq(tripFiles.tripId, trips.id))
      .groupBy(trips.id)
      .orderBy(desc(sql`${trips.status} = 'open'`), desc(trips.createdAt))
    return {
      admin,
      trips: rows.map(({ files, people, ...row }) =>
        admin ? { ...row, files, people } : row
      ),
    }
  },
})

export const getTrip = defineAction({
  name: "get_trip",
  title: "出差內容",
  description:
    "One trip with its files (id, filename, description, size in bytes, uploaded at): the signed-in member's own, or for a trip admin everyone's grouped by member. Use get_trip_file for a file's contents.",
  kind: "query",
  input: z.object({ tripId: id }),
  run: async (actor, { tripId }) => {
    const trip = await findTrip(tripId)
    const admin = await isAdmin(actor, "trip")
    const files = await db
      .select({
        id: tripFiles.id,
        userId: tripFiles.userId,
        member: user.name,
        filename: tripFiles.filename,
        description: tripFiles.description,
        size: tripFiles.size,
        createdAt: tripFiles.createdAt,
      })
      .from(tripFiles)
      .leftJoin(user, eq(user.id, tripFiles.userId))
      .where(
        and(
          eq(tripFiles.tripId, tripId),
          admin ? undefined : eq(tripFiles.userId, actor.userId)
        )
      )
      .orderBy(asc(user.name), desc(tripFiles.createdAt))
    const people = new Map<
      string,
      { userId: string | null; name: string; files: typeof files }
    >()
    for (const file of files) {
      const key = file.userId ?? "left"
      const person = people.get(key) ?? {
        userId: file.userId,
        name: file.member ?? "已離開的成員",
        files: [],
      }
      person.files.push(file)
      people.set(key, person)
    }
    return {
      trip,
      admin,
      mine: files.filter((file) => file.userId === actor.userId),
      people: admin ? [...people.values()] : [],
    }
  },
})

export const getTripFile = defineAction({
  name: "get_trip_file",
  title: "下載檔案",
  description:
    "One trip file's PDF as base64 with its filename: the member's own, or anyone's for a trip admin.",
  kind: "query",
  input: z.object({ fileId: id }),
  run: async (actor, { fileId }) => {
    const { file } = await findFile(actor, fileId)
    const [row] = await db
      .select({ data: tripFiles.data })
      .from(tripFiles)
      .where(eq(tripFiles.id, file.id))
    return {
      filename: file.filename,
      contentType: "application/pdf",
      base64: row.data.toString("base64"),
    }
  },
})

export const exportTripFiles = defineAction({
  name: "export_trip_files",
  title: "打包下載",
  description:
    "A zip of a trip's files as base64, one folder per member (trip admins only); userId limits it to one member's files.",
  kind: "query",
  input: z.object({ tripId: id, userId: id.optional() }),
  run: async (actor, { tripId, userId }) => {
    await requireAdmin(actor, "trip")
    const trip = await findTrip(tripId)
    const rows = await db
      .select({
        member: user.name,
        filename: tripFiles.filename,
        data: tripFiles.data,
      })
      .from(tripFiles)
      .leftJoin(user, eq(user.id, tripFiles.userId))
      .where(
        and(
          eq(tripFiles.tripId, tripId),
          userId ? eq(tripFiles.userId, userId) : undefined
        )
      )
      .orderBy(asc(tripFiles.createdAt))
    if (rows.length === 0) throw new Error("還沒有檔案")
    const entries: Record<string, Uint8Array> = {}
    for (const row of rows) {
      // No separators, and never "." or ".." so no entry leaves its folder.
      const folder = (row.member ?? "已離開的成員")
        .replace(/[\\/:*?"<>|\s]/g, "_")
        .replace(/^\.+$/, "_")
      let name = `${folder}/${row.filename}`
      for (let n = 2; name in entries; n++)
        name = `${folder}/${row.filename.replace(/\.pdf$/, "")} (${n}).pdf`
      entries[name] = new Uint8Array(row.data)
    }
    const zip = zipSync(entries, { level: 0 })
    const label = trip.name.replace(/[\\/:*?"<>|]/g, "_")
    const member = userId && rows[0].member ? `_${rows[0].member}` : ""
    return {
      filename: `${label}${member}.zip`,
      contentType: "application/zip",
      base64: Buffer.from(zip).toString("base64"),
    }
  },
})

export const uploadTripFile = defineAction({
  name: "upload_trip_file",
  title: "上傳檔案",
  description: `Uploads one receipt to an open trip as the signed-in member: a PDF, JPEG or PNG as base64 (images become a one-page PDF), up to ${TRIP_FILE_LIMIT / 1024 / 1024} MB, with an optional description such as "3/14 飯店住宿".`,
  kind: "mutation",
  input: z.object({
    tripId: id,
    filename: z.string().trim().min(1, "缺檔名").max(200),
    contentType: z.enum(uploadTypes, "只收 PDF、JPG、PNG"),
    base64: z.base64("檔案要是 base64"),
    description,
  }),
  run: async (
    actor,
    { tripId, filename, contentType, base64, description }
  ) => {
    const trip = await findTrip(tripId)
    if (trip.status !== "open") throw new Error("這趟出差已經關了")
    const raw = Buffer.from(base64, "base64")
    if (raw.length > TRIP_FILE_LIMIT)
      throw new Error(
        `檔案最大 ${TRIP_FILE_LIMIT / 1024 / 1024} MB，這個 ${(raw.length / 1024 / 1024).toFixed(1)} MB`
      )
    const data = await toPdf(contentType, raw)
    if (data.length > TRIP_FILE_LIMIT)
      throw new Error(`轉成 PDF 後超過 ${TRIP_FILE_LIMIT / 1024 / 1024} MB`)
    const [created] = await db
      .insert(tripFiles)
      .values({
        tripId,
        userId: actor.userId,
        filename: pdfName(filename),
        description,
        size: data.length,
        data,
      })
      .returning({ id: tripFiles.id, filename: tripFiles.filename })
    return created
  },
})

export const updateTripFile = defineAction({
  name: "update_trip_file",
  title: "修改說明",
  description:
    "Changes the description of one of the signed-in member's own files while the trip is open; an empty one clears it.",
  kind: "mutation",
  input: z.object({ fileId: id, description }),
  run: async (actor, { fileId, description }) => {
    const { file, mine } = await findFile(actor, fileId)
    if (!mine) throw new Error("只能改自己的檔案")
    if (file.status !== "open") throw new Error("這趟出差已經關了")
    await db
      .update(tripFiles)
      .set({ description })
      .where(eq(tripFiles.id, fileId))
    return { fileId }
  },
})

export const deleteTripFile = defineAction({
  name: "delete_trip_file",
  title: "刪除檔案",
  description:
    "Deletes a trip file: the member's own while the trip is open, or anyone's at any time for a trip admin. It cannot be undone.",
  kind: "mutation",
  input: z.object({ fileId: id }),
  run: async (actor, { fileId }) => {
    const { file, admin, mine } = await findFile(actor, fileId)
    if (!admin && !(mine && file.status === "open"))
      throw new Error("這趟出差已經關了")
    await db.delete(tripFiles).where(eq(tripFiles.id, fileId))
    return { fileId }
  },
})

const tripFields = {
  name: z.string().trim().min(1, "請填名稱").max(100, "名稱最多 100 字"),
  description: z
    .string()
    .trim()
    .max(500, "說明最多 500 字")
    .nullish()
    .transform((text) => text || null),
}

export const createTrip = defineAction({
  name: "create_trip",
  title: "新增出差",
  description:
    "Opens a trip for uploads (trip admins only): a name such as 2026 ICRA 橫濱 and an optional description (dates, subsidy cap, notes).",
  kind: "mutation",
  input: z.object(tripFields),
  run: async (actor, input) => {
    await requireAdmin(actor, "trip")
    const [created] = await db
      .insert(trips)
      .values({ ...input, createdBy: actor.userId })
      .returning({ id: trips.id, name: trips.name })
    return created
  },
})

export const updateTrip = defineAction({
  name: "update_trip",
  title: "修改出差",
  description:
    "Renames a trip, changes its description, or closes it (status closed: members can no longer upload, edit or delete) and reopens it (trip admins only). Leave out what stays the same.",
  kind: "mutation",
  input: z.object({
    tripId: id,
    name: tripFields.name.optional(),
    description: tripFields.description.optional(),
    status: z.enum(["open", "closed"]).optional(),
  }),
  run: async (actor, { tripId, status, ...changes }) => {
    await requireAdmin(actor, "trip")
    const [updated] = await db
      .update(trips)
      .set({
        ...changes,
        ...(status
          ? { status, closedAt: status === "closed" ? new Date() : null }
          : {}),
      })
      .where(eq(trips.id, tripId))
      .returning({ id: trips.id, status: trips.status })
    if (!updated) throw new Error("找不到這趟出差")
    return updated
  },
})

export const deleteTrip = defineAction({
  name: "delete_trip",
  title: "刪除出差",
  description:
    "Deletes a trip with every file in it (trip admins only). It cannot be undone; confirm with the member first.",
  kind: "mutation",
  input: z.object({ tripId: id }),
  run: async (actor, { tripId }) => {
    await requireAdmin(actor, "trip")
    const removed = await db
      .delete(trips)
      .where(eq(trips.id, tripId))
      .returning({ id: trips.id })
    if (removed.length === 0) throw new Error("找不到這趟出差")
    return { tripId }
  },
})

export const getTripStats = defineAction({
  name: "get_trip_stats",
  title: "出差統計",
  description:
    "Per member: how many trips they uploaded to, how many files and how many bytes. A trip admin sees every member; anyone else sees only themselves.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const admin = await isAdmin(actor, "trip")
    const members = await db
      .select({
        userId: tripFiles.userId,
        name: user.name,
        trips: sql<number>`count(distinct ${tripFiles.tripId})`.mapWith(Number),
        files: count(tripFiles.id),
        bytes: sum(tripFiles.size).mapWith(Number),
      })
      .from(tripFiles)
      .innerJoin(user, eq(user.id, tripFiles.userId))
      .where(admin ? undefined : eq(tripFiles.userId, actor.userId))
      .groupBy(tripFiles.userId, user.name)
      .orderBy(desc(count(tripFiles.id)), asc(user.name))
    return { members }
  },
})
