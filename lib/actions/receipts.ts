import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { receipts, user } from "@/lib/db/schema"
import { processUpload } from "@/lib/pdf-sign"
import { depositAccounts, receiptStatuses } from "@/lib/receipts"

const id = z.uuid("id 格式不對")

/** Largest file accepted, in bytes. */
export const RECEIPT_FILE_LIMIT = 10 * 1024 * 1024
/** Who hears about every new receipt. */
const ACCOUNTING = "accounting@winlab.tw"

const status = z.enum(Object.keys(receiptStatuses) as ["pending", "approved"])
const depositAccount = z.enum(Object.keys(depositAccounts) as ["post", "esun"])
const name = z.string().trim().min(1, "請填名稱").max(200, "名稱最多 200 字")
// Free text: the projects come and go with the grants, and the list to pick
// from is the projects already used.
const project = z
  .string()
  .trim()
  .max(50, "計畫最多 50 字")
  .nullish()
  .transform((text) => text || null)

const fields = {
  id: receipts.id,
  name: receipts.name,
  project: receipts.project,
  depositAccount: receipts.depositAccount,
  status: receipts.status,
  size: receipts.size,
  uploader: user.name,
  createdAt: receipts.createdAt,
}

export type Receipt = {
  id: string
  name: string
  project: string | null
  depositAccount: "post" | "esun" | null
  status: "pending" | "approved"
  size: number
  uploader: string | null
  createdAt: Date
}

export const listReceipts = defineAction({
  name: "list_receipts",
  title: "收據",
  description:
    "Reimbursement receipts, for receipts admins only: pending (審核中) first, then approved (完成), newest first within each, with name, funding project, deposit account (post = 郵局, esun = 玉山), uploader and file size. Also returns every project used so far. status and project filter the list.",
  kind: "query",
  input: z.object({
    status: status.optional(),
    project: z.string().trim().min(1).optional(),
  }),
  run: async (actor, filter) => {
    await requireAdmin(actor, "receipts")
    const [rows, projects] = await Promise.all([
      db
        .select(fields)
        .from(receipts)
        .leftJoin(user, eq(user.id, receipts.uploaderId))
        .where(
          and(
            filter.status ? eq(receipts.status, filter.status) : undefined,
            filter.project ? eq(receipts.project, filter.project) : undefined
          )
        )
        .orderBy(
          desc(sql`${receipts.status} = 'pending'`),
          desc(receipts.createdAt)
        ),
      db
        .selectDistinct({ project: receipts.project })
        .from(receipts)
        .where(isNotNull(receipts.project))
        .orderBy(asc(receipts.project)),
    ])
    return {
      receipts: rows as Receipt[],
      projects: projects.map((row) => row.project as string),
    }
  },
})

export const getReceiptFile = defineAction({
  name: "get_receipt_file",
  title: "下載收據",
  description:
    "One receipt's PDF as base64 with a filename made from its name, for receipts admins only.",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "receipts")
    const [row] = await db
      .select({ name: receipts.name, data: receipts.data })
      .from(receipts)
      .where(eq(receipts.id, id))
    if (!row) throw new Error("找不到這張收據")
    return {
      filename: `${row.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")}.pdf`,
      contentType: "application/pdf",
      base64: row.data.toString("base64"),
    }
  },
})

export const uploadReceipt = defineAction({
  name: "upload_receipt",
  title: "上傳收據",
  description: `Uploads one receipt, for receipts admins only: a PDF or JPEG as base64 (a JPEG becomes a one-page PDF; convert PNGs to JPEG first), up to ${RECEIPT_FILE_LIMIT / 1024 / 1024} MB. It starts as pending (審核中) and accounting is mailed a notice. depositAccount: post = 郵局, esun = 玉山; project is the funding project, reuse one from list_receipts. Ask the member for name, project and account when not given; never invent them.`,
  kind: "mutation",
  input: z.object({
    name,
    project,
    depositAccount,
    contentType: z.enum(["application/pdf", "image/jpeg"], "只收 PDF 和 JPG"),
    base64: z.base64("檔案要是 base64"),
  }),
  run: async (actor, input) => {
    await requireAdmin(actor, "receipts")
    const raw = Buffer.from(input.base64, "base64")
    if (raw.length > RECEIPT_FILE_LIMIT)
      throw new Error(
        `檔案最大 ${RECEIPT_FILE_LIMIT / 1024 / 1024} MB，這個 ${(raw.length / 1024 / 1024).toFixed(1)} MB`
      )
    // Converting and checking the file happen in the PDF worker.
    const { bytes } = await processUpload({
      file: new Uint8Array(raw),
      contentType: input.contentType,
      maxBytes: RECEIPT_FILE_LIMIT,
      signature: null,
    })
    const data = Buffer.from(bytes)
    const [uploader] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actor.userId))
    return db.transaction(async (tx) => {
      const mailId = await queueMail(tx, {
        to: [ACCOUNTING],
        subject: `[WinLab 收據] ${input.name}`,
        text: [
          `${uploader?.name ?? "有人"}上傳了一張收據。`,
          "",
          `名稱：${input.name}`,
          `計畫：${input.project ?? "未填"}`,
          `存入：${depositAccounts[input.depositAccount]}`,
          "",
          `${process.env.BETTER_AUTH_URL}/receipts`,
        ].join("\n"),
      })
      const [created] = await tx
        .insert(receipts)
        .values({
          name: input.name,
          project: input.project,
          depositAccount: input.depositAccount,
          uploaderId: actor.userId,
          size: data.length,
          data,
          mailId,
        })
        .returning({ id: receipts.id, name: receipts.name })
      return created
    })
  },
})

export const updateReceipt = defineAction({
  name: "update_receipt",
  title: "修改收據",
  description:
    "Changes a receipt's name, funding project, deposit account (post = 郵局, esun = 玉山) or status (pending = 審核中, approved = 完成), for receipts admins only; fields left out stay as they are. The file itself cannot change: delete and upload again.",
  kind: "mutation",
  input: z.object({
    id,
    name: name.optional(),
    project: project.optional(),
    depositAccount: depositAccount.optional(),
    status: status.optional(),
  }),
  run: async (actor, { id, ...changes }) => {
    await requireAdmin(actor, "receipts")
    const [updated] = await db
      .update(receipts)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(eq(receipts.id, id))
      .returning({ id: receipts.id, status: receipts.status })
    if (!updated) throw new Error("找不到這張收據")
    return updated
  },
})

export const deleteReceipt = defineAction({
  name: "delete_receipt",
  title: "刪除收據",
  description:
    "Deletes a receipt and its file, for receipts admins only. The notice already mailed to accounting stays sent.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "receipts")
    const [removed] = await db
      .delete(receipts)
      .where(eq(receipts.id, id))
      .returning({ id: receipts.id })
    if (!removed) throw new Error("找不到這張收據")
    return removed
  },
})
