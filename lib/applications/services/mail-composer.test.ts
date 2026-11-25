import { expect, test } from "bun:test"
import { Email } from "../domain/values"
import { pending, profileInput } from "../testing/fixtures"
import { MailComposer } from "./mail-composer"

const urls = {
  siteUrl: "https://portal.example.test",
  applySiteUrl: "https://apply.example.test",
}
const composer = new MailComposer(urls)
const to = Email.parse("applicant@example.com")
const token = "tok_ABC-123_abcdefghijklmnopqrstuvwxyz0123456"

const applyLinks = (mail: { text: string; html: string }) =>
  mail.text.match(/https:\/\/apply\.example\.test\S*/g) ?? []

test("verify", () => {
  const mail = composer.verify(to, token)
  expect(mail.kind).toBe("verify")
  expect(mail.to).toBe(to.value)
  expect(applyLinks(mail)).toEqual([`${urls.applySiteUrl}/confirm/${token}`])
  expect(mail.html).toContain(`${urls.applySiteUrl}/confirm/${token}`)
  expect(mail).toMatchSnapshot()
})

test("link", () => {
  const mail = composer.link(to, token)
  expect(mail.kind).toBe("link")
  expect(applyLinks(mail)).toEqual([`${urls.applySiteUrl}/status/${token}`])
  expect(mail).toMatchSnapshot()
})

test("received goes to the applicant with the status link", async () => {
  const app = await pending()
  const mail = composer.received(app, token)
  expect(mail.kind).toBe("received")
  expect(mail.to).toBe(app.email!.value)
  expect(applyLinks(mail)).toEqual([`${urls.applySiteUrl}/status/${token}`])
  expect({ ...mail, to: "<email>" }).toMatchSnapshot()
})

test("hasAccount points to sign in without a link", () => {
  const mail = composer.hasAccount(to)
  expect(mail.kind).toBe("has_account")
  expect(mail.text).toContain(
    "你已經有帳號，請登入或用登入頁的『忘記密碼』"
  )
  expect(mail.text).not.toMatch(/https?:\/\//)
  expect(mail.html).not.toMatch(/href=/)
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
