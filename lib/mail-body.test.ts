import { describe, expect, test } from "bun:test"

import { mailBody } from "./mail-body"

describe("mailBody", () => {
  test("row values are data: a URL in one is not turned into a link", () => {
    const { html, text } = mailBody({
      title: "通知",
      rows: [["LINE ID", "https://evil.example/login"]],
    })
    expect(html).not.toContain('href="https://evil.example/login"')
    expect(html).toContain("https://evil.example/login")
    expect(text).toContain("LINE ID：https://evil.example/login")
  })

  test("row values are escaped", () => {
    const { html } = mailBody({ title: "通知", rows: [["姓名", "<b>x</b>"]] })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).not.toContain("<b>x</b>")
  })

  test("paragraphs still link URLs", () => {
    const { html } = mailBody({
      title: "通知",
      paragraphs: ["到 https://portal.winlab.tw/applications 看"],
    })
    expect(html).toContain('href="https://portal.winlab.tw/applications"')
  })
})
