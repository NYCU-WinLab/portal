import { expect, test } from "bun:test"
import { Email } from "../domain/values"
import { pending, profileInput } from "../testing/fixtures"
import { MailComposer } from "./mail-composer"

// The footer link reads this; pin it so snapshots do not depend on the env.
process.env.BETTER_AUTH_URL = "https://portal.example.test"

const urls = { siteUrl: "https://portal.example.test" }
const applySite = "https://apply.example.test"
const composer = new MailComposer(urls)
const to = Email.parse("applicant@example.com")
const token = "tok_ABC-123_abcdefghijklmnopqrstuvwxyz0123456"

const applyLinks = (mail: { text: string; html: string }) =>
  mail.text.match(/https:\/\/apply\.example\.test\S*/g) ?? []

test("verify", () => {
  const mail = composer.verify(to, token, applySite)
  expect(mail.kind).toBe("verify")
  expect(mail.to).toBe(to.value)
  expect(applyLinks(mail)).toEqual([`${applySite}/confirm?token=${token}`])
  expect(mail.html).toContain(`${applySite}/confirm?token=${token}`)
  expect(mail).toMatchSnapshot()
})

test("link", () => {
  const mail = composer.link(to, token, applySite)
  expect(mail.kind).toBe("link")
  expect(applyLinks(mail)).toEqual([`${applySite}/status?token=${token}`])
  expect(mail).toMatchSnapshot()
})

test("received goes to the applicant with the status link", async () => {
  const app = await pending()
  const mail = composer.received(app, token, applySite)
  expect(mail.kind).toBe("received")
  expect(mail.to).toBe(app.email!.value)
  expect(applyLinks(mail)).toEqual([`${applySite}/status?token=${token}`])
  expect({ ...mail, to: "<email>" }).toMatchSnapshot()
})

test("hasAccount points to sign in without a link", () => {
  const mail = composer.hasAccount(to)
  expect(mail.kind).toBe("has_account")
  expect(mail.text).toContain("你已經有帳號，請登入或用登入頁的『忘記密碼』")
  expect(mail.text).not.toMatch(/https?:\/\//)
  expect(mail.html).not.toContain("apply.example.test")
  expect(mail.html).not.toContain('class="action"')
  expect(mail).toMatchSnapshot()
})

test("processorNotice holds no personal data", async () => {
  const app = await pending()
  const mail = composer.processorNotice(app, "processor@example.com")
  expect(mail.kind).toBe("processor_notice")
  expect(mail.to).toBe("processor@example.com")
  const p = profileInput()
  const all = [mail.subject, mail.text, mail.html].join("\n")
  for (const secret of [
    p.chineseName,
    `${p.firstName}`,
    `${p.lastName}`,
    p.phone,
    p.lineId,
    p.username,
    app.email!.value,
  ]) {
    expect(all).not.toContain(secret as string)
  }
  expect(mail.text).toContain(`${urls.siteUrl}/applications`)
  expect(mail.text).toContain("有一筆新的帳號申請")
  expect(mail).toMatchSnapshot()
})

test("changesRequested carries the note, the due date and the status link", async () => {
  const app = await pending()
  // 2026-12-03 17:00 UTC is already 12-04 in Taipei.
  const dueAt = new Date("2026-12-03T17:00:00Z")
  const mail = composer.changesRequested(
    app,
    token,
    "請補上指導教授的名字",
    dueAt,
    applySite
  )
  expect(mail.kind).toBe("changes_requested")
  expect(mail.to).toBe(app.email!.value)
  expect(applyLinks(mail)).toEqual([`${applySite}/status/${token}`])
  expect(mail.text).toContain("請補上指導教授的名字")
  expect(mail.text).toContain("2026-12-04")
  expect(mail.html).toContain("請補上指導教授的名字")
  expect({ ...mail, to: "<email>" }).toMatchSnapshot()
})

test("rejected includes the note only when there is one", async () => {
  const app = await pending()
  const withNote = composer.rejected(app, "名額已滿")
  expect(withNote.kind).toBe("rejected")
  expect(withNote.to).toBe(app.email!.value)
  expect(withNote.text).toContain("名額已滿")
  expect(withNote.text).not.toMatch(/https?:\/\//)
  expect({ ...withNote, to: "<email>" }).toMatchSnapshot()

  const bare = composer.rejected(app, null)
  expect(bare.text).not.toContain("名額已滿")
  expect(bare.text).not.toMatch(/https?:\/\//)
  expect({ ...bare, to: "<email>" }).toMatchSnapshot()
})

test("cohortMissing names the cohort and group path, not the applicant", () => {
  const mail = composer.cohortMissing(
    "admin@example.com",
    2026,
    "/winlab/students/2026"
  )
  expect(mail.kind).toBe("cohort_missing")
  expect(mail.to).toBe("admin@example.com")
  expect(mail.text).toContain("2026")
  expect(mail.text).toContain("/winlab/students/2026")
  expect(mail.text).toContain(`${urls.siteUrl}/applications`)
  expect(mail).toMatchSnapshot()
})
