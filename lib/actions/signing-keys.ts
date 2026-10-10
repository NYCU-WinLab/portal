import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"

import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { signingKeys } from "@/lib/db/schema"
import {
  generateKeyPair,
  issueCertificate,
  issueCrl,
  type ParsedCertificate,
  parseCertificate,
  pem,
  RSA_PARAMS,
} from "@/lib/pki/x509"

// Issues and keeps the CA's keys (not actions themselves, apart from
// get_signing_root; they live here because only lib/actions touches the
// database). Only lib/pdf-sign and the /pki routes use them, and no private
// key ever leaves the server.

const ROOT_NAME = "WinLab Portal Root CA"
const ROOT_YEARS = 20
const MEMBER_YEARS = 2
/** A member certificate this close to expiry is replaced before signing. */
const RENEW_BEFORE_DAYS = 30

async function masterKey() {
  const raw = process.env.SIGNING_MASTER_KEY
  if (!raw) throw new Error("簽章金鑰未設定(SIGNING_MASTER_KEY)")
  const bytes = Buffer.from(raw, "base64")
  if (bytes.length !== 32)
    throw new Error("SIGNING_MASTER_KEY 要是 32 bytes 的 base64")
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  )
}

async function seal(key: CryptoKey) {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", key)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await masterKey(),
    pkcs8
  )
  return Buffer.concat([iv, Buffer.from(sealed)])
}

async function unseal(sealed: Buffer) {
  const pkcs8 = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(sealed.subarray(0, 12)) },
    await masterKey(),
    new Uint8Array(sealed.subarray(12))
  )
  return crypto.subtle.importKey("pkcs8", pkcs8, RSA_PARAMS, false, ["sign"])
}

/** Public URLs the certificates point at, from the portal's own address. */
export function pkiUrls() {
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")
  return { crl: `${base}/pki/root.crl`, certificate: `${base}/pki/root.crt` }
}

const years = (from: Date, n: number) =>
  new Date(from.getTime() + n * 365.25 * 24 * 3600 * 1000)

export type SigningIdentity = {
  certificate: ParsedCertificate
  key: CryptoKey
}

async function loadRoot() {
  const [row] = await db
    .select()
    .from(signingKeys)
    .where(and(eq(signingKeys.kind, "root"), isNull(signingKeys.revokedAt)))
  return row
}

let rootCache: SigningIdentity | null = null

/** The root CA, made on first use, kept in memory once loaded. */
export async function rootIdentity(): Promise<SigningIdentity> {
  if (rootCache) return rootCache
  let row = await loadRoot()
  if (!row) {
    row = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('signing_keys root'))`
      )
      const [existing] = await tx
        .select()
        .from(signingKeys)
        .where(and(eq(signingKeys.kind, "root"), isNull(signingKeys.revokedAt)))
      if (existing) return existing
      const pair = await generateKeyPair()
      const now = new Date()
      const notAfter = years(now, ROOT_YEARS)
      const der = await issueCertificate(
        {
          subject: ROOT_NAME,
          publicKey: pair.publicKey,
          issuer: "self",
          ca: true,
          notBefore: now,
          notAfter,
        },
        pair.privateKey
      )
      const [created] = await tx
        .insert(signingKeys)
        .values({
          kind: "root",
          certificate: Buffer.from(der),
          privateKey: await seal(pair.privateKey),
          serial: parseCertificate(der).serial.toString(16),
          notAfter,
        })
        .returning()
      return created
    })
  }
  rootCache = {
    certificate: parseCertificate(new Uint8Array(row.certificate)),
    key: await unseal(row.privateKey),
  }
  return rootCache
}

/** The member's signing certificate, issued (or renewed) when needed. */
export async function memberIdentity(
  userId: string,
  displayName: string
): Promise<SigningIdentity> {
  const usable = (row: typeof signingKeys.$inferSelect | undefined) =>
    row &&
    row.notAfter.getTime() - Date.now() > RENEW_BEFORE_DAYS * 24 * 3600 * 1000
  const current = () =>
    db
      .select()
      .from(signingKeys)
      .where(
        and(
          eq(signingKeys.kind, "member"),
          eq(signingKeys.userId, userId),
          isNull(signingKeys.revokedAt)
        )
      )
  let [row] = await current()
  if (!usable(row)) {
    const root = await rootIdentity()
    row = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`signing_keys ${userId}`}))`
      )
      const [existing] = await tx
        .select()
        .from(signingKeys)
        .where(
          and(
            eq(signingKeys.kind, "member"),
            eq(signingKeys.userId, userId),
            isNull(signingKeys.revokedAt)
          )
        )
      if (usable(existing)) return existing!
      // An expiring certificate is retired, not revoked: what it signed
      // stays valid.
      if (existing)
        await tx
          .update(signingKeys)
          .set({ revokedAt: existing.notAfter })
          .where(eq(signingKeys.id, existing.id))
      const pair = await generateKeyPair()
      const now = new Date()
      const notAfter = years(now, MEMBER_YEARS)
      const urls = pkiUrls()
      const der = await issueCertificate(
        {
          subject: displayName,
          publicKey: pair.publicKey,
          issuer: {
            name: root.certificate.subject,
            key: root.key,
            spki: root.certificate.spki,
          },
          ca: false,
          notBefore: now,
          notAfter,
          crlUrl: urls.crl,
          issuerUrl: urls.certificate,
        },
        root.key
      )
      const [created] = await tx
        .insert(signingKeys)
        .values({
          kind: "member",
          userId,
          certificate: Buffer.from(der),
          privateKey: await seal(pair.privateKey),
          serial: parseCertificate(der).serial.toString(16),
          notAfter,
        })
        .returning()
      return created
    })
  }
  return {
    certificate: parseCertificate(new Uint8Array(row!.certificate)),
    key: await unseal(row!.privateKey),
  }
}

let crlCache: { crl: Uint8Array; until: number } | null = null

/** The root's current CRL, valid for a week and reissued at most hourly
 * (the public route would otherwise sign on every request). Retired
 * certificates (renewed on expiry) are not listed: only ones revoked
 * before they expired. */
export async function currentCrl() {
  if (crlCache && crlCache.until > Date.now()) return crlCache.crl
  const root = await rootIdentity()
  const revoked = await db
    .select({ serial: signingKeys.serial, at: signingKeys.revokedAt })
    .from(signingKeys)
    .where(
      and(
        eq(signingKeys.kind, "member"),
        isNotNull(signingKeys.revokedAt),
        sql`${signingKeys.revokedAt} < ${signingKeys.notAfter}`
      )
    )
  const now = new Date()
  const crl = await issueCrl({
    issuer: root.certificate.subject,
    issuerSpki: root.certificate.spki,
    key: root.key,
    number: BigInt(Math.floor(now.getTime() / 1000)),
    thisUpdate: now,
    nextUpdate: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
    revoked: revoked.map((row) => ({
      serial: BigInt(`0x${row.serial}`),
      at: row.at!,
    })),
  })
  crlCache = { crl, until: now.getTime() + 3600 * 1000 }
  return crl
}

export const getSigningRoot = defineAction({
  name: "get_signing_root",
  title: "實驗室根憑證",
  description:
    "The WinLab Portal Root CA certificate (PEM) that signs every member's signing certificate. Import it as a trusted root in a PDF reader to see portal signatures as valid. Public: the same file is at /pki/root.crt.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const root = await rootIdentity()
    return { pem: pem(root.certificate.der), url: pkiUrls().certificate }
  },
})
