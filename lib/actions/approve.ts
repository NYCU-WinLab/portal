import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction, type Actor } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import {
  approveDocuments,
  approveFields,
  approveSavedValues,
  approveSigners,
  signatures,
  user,
} from "@/lib/db/schema"
import { processUpload } from "@/lib/pdf-sign"

// Documents sent round for signatures (/approve). A creator uploads a PDF,
// places fields for signers and sends it; each signer fills in theirs, a
// signature with the one saved on their account; when the last one signs
// the creator is mailed.

const PDF_LIMIT = 10 * 1024 * 1024
export const fieldCategories = [
  "signature",
  "contact_address",
  "household_address",
  "id_number",
  "phone",
  "other",
] as const

const id = z.uuid("id 格式不對")
const link = (documentId: string) =>
  `${process.env.BETTER_AUTH_URL}/approve/${documentId}`

async function findDocument(documentId: string) {
  const [doc] = await db
    .select({
      id: approveDocuments.id,
      title: approveDocuments.title,
      status: approveDocuments.status,
      createdBy: approveDocuments.createdBy,
      hasPdf: sql<boolean>`${approveDocuments.pdf} is not null`,
    })
    .from(approveDocuments)
    .where(eq(approveDocuments.id, documentId))
  if (!doc) throw new Error("找不到這份文件")
  return doc
}

/** The document, when the member created it or must sign it. */
async function visibleDocument(actor: Actor, documentId: string) {
  const doc = await findDocument(documentId)
  if (doc.createdBy === actor.userId) return doc
  const [signer] = await db
    .select({ signerId: approveSigners.signerId })
    .from(approveSigners)
    .where(
      and(
        eq(approveSigners.documentId, documentId),
        eq(approveSigners.signerId, actor.userId)
      )
    )
  if (!signer) throw new Error("找不到這份文件")
  return doc
}

async function draftOf(actor: Actor, documentId: string) {
  const doc = await findDocument(documentId)
  if (doc.createdBy !== actor.userId) throw new Error("只能改自己建立的文件")
  if (doc.status !== "draft") throw new Error("已經送出，不能再改")
  return doc
}

export const listApproveDocuments = defineAction({
  name: "list_approve_documents",
  title: "簽核文件",
  description:
    "Documents the signed-in member created or must sign, newest first: id, title, status (draft, pending, completed), creator, each signer with signed_at, and to_sign true when the member still has to sign it. Only the member's own documents and ones they sign; nobody else's.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const mine = db
      .select({ id: approveSigners.documentId })
      .from(approveSigners)
      .where(eq(approveSigners.signerId, actor.userId))
    const docs = await db
      .select({
        id: approveDocuments.id,
        title: approveDocuments.title,
        status: approveDocuments.status,
        createdBy: approveDocuments.createdBy,
        creator: user.name,
        createdAt: approveDocuments.createdAt,
        completedAt: approveDocuments.completedAt,
      })
      .from(approveDocuments)
      .innerJoin(user, eq(user.id, approveDocuments.createdBy))
      .where(
        or(
          eq(approveDocuments.createdBy, actor.userId),
          and(
            inArray(approveDocuments.id, mine),
            sql`${approveDocuments.status} <> 'draft'`
          )
        )
      )
      .orderBy(desc(approveDocuments.createdAt))
    const signers = docs.length
      ? await db
          .select({
            documentId: approveSigners.documentId,
            userId: approveSigners.signerId,
            name: user.name,
            signedAt: approveSigners.signedAt,
          })
          .from(approveSigners)
          .innerJoin(user, eq(user.id, approveSigners.signerId))
          .where(
            inArray(
              approveSigners.documentId,
              docs.map((doc) => doc.id)
            )
          )
          .orderBy(asc(user.name))
      : []
    return {
      documents: docs.map((doc) => {
        const list = signers.filter((s) => s.documentId === doc.id)
        return {
          ...doc,
          signers: list.map(({ userId, name, signedAt }) => ({
            userId,
            name,
            signedAt,
          })),
          toSign:
            doc.status === "pending" &&
            list.some((s) => s.userId === actor.userId && !s.signedAt),
        }
      }),
    }
  },
})

export const getApproveDocument = defineAction({
  name: "get_approve_document",
  title: "簽核文件內容",
  description:
    "One document the member created or signs: title, status, creator, signers, and every field (page, box in fractions of the page from the top left, category, label, signer, the value once signed). to_fill lists the member's own empty fields, prefilled from what they entered last time; a signature is filled from the signature saved on their account.",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, input) => {
    const doc = await visibleDocument(actor, input.id)
    const [creator] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, doc.createdBy))
    const fields = await db
      .select({
        id: approveFields.id,
        signerId: approveFields.signerId,
        signerName: user.name,
        page: approveFields.page,
        x: approveFields.x,
        y: approveFields.y,
        width: approveFields.width,
        height: approveFields.height,
        category: approveFields.category,
        label: approveFields.label,
        value: approveFields.value,
        signedAt: approveFields.signedAt,
      })
      .from(approveFields)
      .leftJoin(user, eq(user.id, approveFields.signerId))
      .where(eq(approveFields.documentId, doc.id))
      .orderBy(asc(approveFields.page), asc(approveFields.y))
    const signers = await db
      .select({
        userId: approveSigners.signerId,
        name: user.name,
        signedAt: approveSigners.signedAt,
      })
      .from(approveSigners)
      .innerJoin(user, eq(user.id, approveSigners.signerId))
      .where(eq(approveSigners.documentId, doc.id))
    const saved = await db
      .select({
        category: approveSavedValues.category,
        value: approveSavedValues.value,
      })
      .from(approveSavedValues)
      .where(eq(approveSavedValues.userId, actor.userId))
    const toFill =
      doc.status === "pending"
        ? fields
            .filter((f) => f.signerId === actor.userId && !f.signedAt)
            .map((f) => ({
              id: f.id,
              category: f.category,
              label: f.label,
              prefill:
                f.category === "other" || f.category === "signature"
                  ? null
                  : (saved.find((s) => s.category === f.category)?.value ??
                    null),
            }))
        : []
    // Values are personal (ID numbers, addresses): a signer sees only their
    // own, the creator every one. A signature is an image; agents learn a
    // field is signed, not the image itself.
    const mine = doc.createdBy === actor.userId
    const shown = fields.map((f) => {
      if (!mine && f.signerId !== actor.userId) return { ...f, value: null }
      if (actor.via !== "web" && f.category === "signature" && f.value)
        return { ...f, value: "（已簽名）" }
      return f
    })
    return {
      ...doc,
      creator: creator?.name ?? "",
      mine: doc.createdBy === actor.userId,
      signers,
      fields: shown,
      toFill,
    }
  },
})

export const getApproveFile = defineAction({
  name: "get_approve_file",
  title: "簽核原始檔",
  description:
    "The original PDF of a document the member created or signs, as base64 (without the filled-in fields).",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, input) => {
    const doc = await visibleDocument(actor, input.id)
    const [row] = await db
      .select({ pdf: approveDocuments.pdf })
      .from(approveDocuments)
      .where(eq(approveDocuments.id, doc.id))
    if (!row?.pdf) throw new Error("這份文件還沒有上傳 PDF")
    return {
      filename: `${doc.title}.pdf`,
      contentType: "application/pdf",
      base64: row.pdf.toString("base64"),
    }
  },
})

export const createApproveDocument = defineAction({
  name: "create_approve_document",
  title: "新增簽核文件",
  description: `Starts a draft document for the member to send round: a title and the PDF as base64 (up to ${PDF_LIMIT / 1024 / 1024} MB). Fields are placed with set_approve_fields, then it is sent with submit_approve_document.`,
  kind: "mutation",
  input: z.object({
    title: z.string().trim().min(1, "請填標題").max(200),
    base64: z
      .base64("檔案要是 base64")
      .max(Math.ceil((PDF_LIMIT * 4) / 3) + 4, "PDF 最大 10 MB"),
  }),
  run: async (actor, { title, base64 }) => {
    const raw = Buffer.from(base64, "base64")
    if (raw.length > PDF_LIMIT) throw new Error("PDF 最大 10 MB")
    const { bytes } = await processUpload({
      file: new Uint8Array(raw),
      contentType: "application/pdf",
      maxBytes: PDF_LIMIT,
      signature: null,
    })
    const [created] = await db
      .insert(approveDocuments)
      .values({ title, pdf: Buffer.from(bytes), createdBy: actor.userId })
      .returning({ id: approveDocuments.id })
    return created
  },
})

export const renameApproveDocument = defineAction({
  name: "rename_approve_document",
  title: "改簽核標題",
  description: "Renames one of the member's own draft documents.",
  kind: "mutation",
  input: z.object({ id, title: z.string().trim().min(1).max(200) }),
  run: async (actor, input) => {
    await draftOf(actor, input.id)
    await db
      .update(approveDocuments)
      .set({ title: input.title, updatedAt: sql`now()` })
      .where(eq(approveDocuments.id, input.id))
    return { id: input.id }
  },
})

const field = z.object({
  id,
  signerId: id.nullable(),
  page: z.number().int().min(1).max(500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  category: z.enum(fieldCategories),
  label: z.string().trim().max(100).nullish(),
})

export const setApproveFields = defineAction({
  name: "set_approve_fields",
  title: "設定簽核欄位",
  description:
    "Replaces every field on one of the member's own drafts: each a box on a page (fractions of the page from the top left), its category (signature, contact_address, household_address, id_number, phone or other with a label) and the member who fills it (signerId from list_members). Signers follow from the fields.",
  kind: "mutation",
  input: z.object({ id, fields: z.array(field).max(300) }),
  run: async (actor, input) => {
    await draftOf(actor, input.id)
    if (new Set(input.fields.map((f) => f.id)).size !== input.fields.length)
      throw new Error("欄位 id 重複")
    const signerIds = [
      ...new Set(input.fields.flatMap((f) => (f.signerId ? [f.signerId] : []))),
    ]
    if (signerIds.length) {
      const found = await db
        .select({ id: user.id })
        .from(user)
        .where(inArray(user.id, signerIds))
      if (found.length !== signerIds.length) throw new Error("有簽核人不是成員")
    }
    const taken = input.fields.length
      ? await db
          .select({ id: approveFields.id })
          .from(approveFields)
          .where(
            and(
              inArray(
                approveFields.id,
                input.fields.map((f) => f.id)
              ),
              sql`${approveFields.documentId} <> ${input.id}`
            )
          )
      : []
    if (taken.length) throw new Error("欄位 id 已被別份文件使用")
    await db.transaction(async (tx) => {
      await tx
        .delete(approveFields)
        .where(eq(approveFields.documentId, input.id))
      if (input.fields.length)
        await tx.insert(approveFields).values(
          input.fields.map((f) => ({
            ...f,
            label: f.label || null,
            documentId: input.id,
          }))
        )
      await tx
        .update(approveDocuments)
        .set({ updatedAt: sql`now()` })
        .where(eq(approveDocuments.id, input.id))
    })
    return { fields: input.fields.length }
  },
})

export const submitApproveDocument = defineAction({
  name: "submit_approve_document",
  title: "送出簽核",
  description:
    "Sends one of the member's own drafts round: every field must have a signer, and each signer is mailed a link to sign. It can no longer be edited after this.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, input) => {
    const doc = await draftOf(actor, input.id)
    if (!doc.hasPdf) throw new Error("還沒有上傳 PDF")
    const fields = await db
      .select({ signerId: approveFields.signerId })
      .from(approveFields)
      .where(eq(approveFields.documentId, doc.id))
    if (!fields.length) throw new Error("還沒有放任何欄位")
    if (fields.some((f) => !f.signerId)) throw new Error("有欄位還沒指定簽核人")
    const signerIds = [...new Set(fields.map((f) => f.signerId!))]
    const [creator] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actor.userId))
    const emails = await db
      .select({ email: user.email })
      .from(user)
      .where(inArray(user.id, signerIds))
    await db.transaction(async (tx) => {
      const [sent] = await tx
        .update(approveDocuments)
        .set({ status: "pending", updatedAt: sql`now()` })
        .where(
          and(
            eq(approveDocuments.id, doc.id),
            eq(approveDocuments.status, "draft")
          )
        )
        .returning({ id: approveDocuments.id })
      if (!sent) throw new Error("已經送出了")
      await tx
        .insert(approveSigners)
        .values(signerIds.map((signerId) => ({ documentId: doc.id, signerId })))
      await queueMail(tx, {
        to: [],
        bcc: emails.map((row) => row.email),
        subject: `[WinLab 簽核] 請簽核：${doc.title}`,
        ...mailBody({
          title: doc.title,
          paragraphs: [`${creator?.name ?? "有人"}請你簽核這份文件。`],
          action: { label: "簽核", url: link(doc.id) },
        }),
      })
    })
    return { id: doc.id, signers: signerIds.length }
  },
})

export const signApproveDocument = defineAction({
  name: "sign_approve_document",
  title: "簽核",
  description:
    "Signs a pending document as the member: values fills their non-signature fields by field id (empty ones fall back to what they entered last time, see to_fill in get_approve_document); signature fields take the signature saved on their account, never an image from the caller. Fails while any of their fields stays empty. When the last signer signs, the creator is mailed.",
  kind: "mutation",
  input: z.object({
    id,
    values: z.record(z.string(), z.string().trim().max(500)).default({}),
  }),
  run: async (actor, input) => {
    const doc = await visibleDocument(actor, input.id)
    if (doc.status !== "pending") throw new Error("這份文件不在簽核中")
    const [signature] = await db
      .select({ image: signatures.image, type: signatures.contentType })
      .from(signatures)
      .where(eq(signatures.userId, actor.userId))
    const saved = await db
      .select({
        category: approveSavedValues.category,
        value: approveSavedValues.value,
      })
      .from(approveSavedValues)
      .where(eq(approveSavedValues.userId, actor.userId))
    return db.transaction(async (tx) => {
      // The document row first: the last two signers signing at once would
      // otherwise each still see the other pending, and nobody completes it.
      const [locked] = await tx
        .select({ status: approveDocuments.status })
        .from(approveDocuments)
        .where(eq(approveDocuments.id, doc.id))
        .for("update")
      if (locked?.status !== "pending") throw new Error("這份文件不在簽核中")
      // Locks the member's row so a double submit signs once.
      const [me] = await tx
        .select({ signedAt: approveSigners.signedAt })
        .from(approveSigners)
        .where(
          and(
            eq(approveSigners.documentId, doc.id),
            eq(approveSigners.signerId, actor.userId)
          )
        )
        .for("update")
      if (!me) throw new Error("你不是這份文件的簽核人")
      if (me.signedAt) throw new Error("你已經簽過了")
      const fields = await tx
        .select({ id: approveFields.id, category: approveFields.category })
        .from(approveFields)
        .where(
          and(
            eq(approveFields.documentId, doc.id),
            eq(approveFields.signerId, actor.userId)
          )
        )
      const unknown = Object.keys(input.values).filter(
        (key) => !fields.some((f) => f.id === key && f.category !== "signature")
      )
      if (unknown.length) throw new Error("有欄位不是你要填的")
      const filled = fields.map((f) => {
        if (f.category === "signature") {
          if (!signature?.image || !signature.type)
            throw new Error("你還沒有存簽名，先到個人頁簽名")
          return {
            ...f,
            value: `data:${signature.type};base64,${signature.image.toString("base64")}`,
          }
        }
        const value =
          input.values[f.id] ||
          (f.category === "other"
            ? ""
            : (saved.find((s) => s.category === f.category)?.value ?? ""))
        if (!value) throw new Error("還有欄位沒填")
        return { ...f, value }
      })
      for (const f of filled)
        await tx
          .update(approveFields)
          .set({ value: f.value, signedAt: sql`now()` })
          .where(eq(approveFields.id, f.id))
      for (const f of filled.filter(
        (f) => f.category !== "other" && f.category !== "signature"
      ))
        await tx
          .insert(approveSavedValues)
          .values({
            userId: actor.userId,
            category: f.category,
            value: f.value,
          })
          .onConflictDoUpdate({
            target: [approveSavedValues.userId, approveSavedValues.category],
            set: { value: f.value, updatedAt: sql`now()` },
          })
      await tx
        .update(approveSigners)
        .set({ signedAt: sql`now()` })
        .where(
          and(
            eq(approveSigners.documentId, doc.id),
            eq(approveSigners.signerId, actor.userId)
          )
        )
      const [left] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(approveSigners)
        .where(
          and(
            eq(approveSigners.documentId, doc.id),
            isNull(approveSigners.signedAt)
          )
        )
      if (left.count === 0) {
        await tx
          .update(approveDocuments)
          .set({
            status: "completed",
            completedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(approveDocuments.id, doc.id))
        const [creator] = await tx
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, doc.createdBy))
        if (creator)
          await queueMail(tx, {
            to: [creator.email],
            subject: `[WinLab 簽核] 已簽核完成：${doc.title}`,
            ...mailBody({
              title: doc.title,
              paragraphs: ["所有人都簽好了。"],
              action: { label: "查看文件", url: link(doc.id) },
            }),
          })
      }
      return { signed: true, completed: left.count === 0 }
    })
  },
})

export const deleteApproveDocument = defineAction({
  name: "delete_approve_document",
  title: "刪除簽核文件",
  description:
    "Deletes one of the member's own documents that is not completed yet (a draft, or a pending one nobody needs to sign anymore). Completed documents stay.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, input) => {
    const doc = await findDocument(input.id)
    if (doc.createdBy !== actor.userId) throw new Error("只能刪自己建立的文件")
    if (doc.status === "completed") throw new Error("已完成的文件不能刪")
    await db.delete(approveDocuments).where(eq(approveDocuments.id, doc.id))
    return { deleted: true }
  },
})
