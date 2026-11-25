import { describe, expect, test } from "bun:test"
import { Refusal } from "@/lib/refusal"
import { ApplicationRefusal, type RefusalCode } from "./refusal"
import {
  ApplicantProfile,
  Cohort,
  Email,
  parseRequestedStatus,
  TokenHash,
  Username,
  type ProfileInput,
} from "./values"

const reserved = { has: async (n: string) => ["root", "ssh-gpu"].includes(n) }
const refusal = (code: RefusalCode, field?: string) =>
  new ApplicationRefusal(code, field)

describe("Email", () => {
  test("trims and lowercases", () =>
    expect(Email.parse("  Xiao.Ming@Example.COM ").value).toBe(
      "xiao.ming@example.com"
    ))
  test.each([
    "",
    "a",
    "a@",
    "@b.tw",
    "a@@b.tw",
    "a b@c.tw",
    `${"a".repeat(250)}@b.tw`,
    // nodemailer reads these as a different or an extra recipient
    "a,victim@x.com",
    "x;victim@x.com",
    "<a@b.tw>",
    '"a"@b.tw',
    "a(c)@b.tw",
    "a\\b@c.tw",
    "a:b@c.tw",
    "a@[1.2.3.4]",
    "a\u0000b@c.tw",
    "a\u007fb@c.tw",
    "\u00e9@b.tw",
    "a@b\u00fc.tw",
    "a@localhost",
    "a@b..tw",
    "a@.b.tw",
    "a@b.tw.",
    ".a@b.tw",
    "a.@b.tw",
    "a..b@c.tw",
  ])("rejects %p", (raw) =>
    expect(() => Email.parse(raw)).toThrow(refusal("invalid_input", "email"))
  )
  test("names the field it parses", () =>
    expect(() => Email.parse("x", "nycu_email")).toThrow(
      refusal("invalid_input", "nycu_email")
    ))
  test("gmail dots and plus suffix share a rate key", () => {
    expect(Email.parse("A.B+x@gmail.com").rateKey()).toBe("ab@gmail.com")
    expect(Email.parse("ab@googlemail.com").rateKey()).toBe("ab@gmail.com")
  })
  test("accepts the addr-spec characters", () =>
    expect(Email.parse("a.b+c_d-e'f@mail-1.b.tw").value).toBe(
      "a.b+c_d-e'f@mail-1.b.tw"
    ))
  test("other domains keep dots and drop the plus suffix", () =>
    expect(Email.parse("a.b+x@nycu.edu.tw").rateKey()).toBe("a.b@nycu.edu.tw"))
  test("plus tags share a rate key on every domain", () => {
    expect(Email.parse("victim+1@outlook.com").rateKey()).toBe(
      "victim@outlook.com"
    )
    expect(Email.parse("victim+2@outlook.com").rateKey()).toBe(
      "victim@outlook.com"
    )
    expect(Email.parse("victim@outlook.com").rateKey()).toBe(
      "victim@outlook.com"
    )
  })
})

describe("Username", () => {
  test.each([
    ["ab", false],
    ["abc", true],
    ["a".repeat(32), true],
    ["a".repeat(33), false],
    ["Tim", false],
    ["1abc", false],
    ["x.m_9-w", true],
    ["root", false],
    ["ssh-gpu", false],
  ])("%p valid: %p", async (raw, ok) => {
    const parsing = Username.parse(raw, reserved)
    if (ok) expect((await parsing).value).toBe(raw)
    else
      await expect(parsing).rejects.toThrow(
        refusal("invalid_input", "username")
      )
  })
})

describe("Cohort", () => {
  test.each([
    ["2026-11-24T00:00:00+08:00", 116],
    ["2027-08-31T12:00:00+08:00", 116],
    ["2027-09-01T00:00:00+08:00", 117],
    ["2027-08-31T16:00:00Z", 117],
  ])("defaultFor(%p) = %p", (at, value) =>
    expect(Cohort.defaultFor(new Date(at)).value).toBe(value)
  )
  test.each([99, 1000, 116.5])("rejects %p", (n) =>
    expect(() => Cohort.parse(n)).toThrow(refusal("invalid_input", "cohort"))
  )
})

describe("TokenHash", () => {
  test("accepts 64 lowercase hex", () =>
    expect(TokenHash.parse("a".repeat(64)).value).toBe("a".repeat(64)))
  test.each(["A".repeat(64), "a".repeat(63), "g".repeat(64)])(
    "rejects %p",
    (hex) =>
      expect(() => TokenHash.parse(hex)).toThrow(
        refusal("invalid_input", "token_hash")
      )
  )
})

describe("ApplicantProfile", () => {
  const input: ProfileInput = {
    username: "xmwang",
    chineseName: " 王小明 ",
    firstName: "Xiao-Ming",
    lastName: "Wang",
    studentId: "",
    birthday: "2001-02-03",
    phone: "0912-345 678",
    nycuEmail: " X@NYCU.edu.tw ",
    department: "資工",
    lineId: "xmwang",
  }
  test("normalizes whitespace, phone, empty optionals and nycu email", async () => {
    const p = await ApplicantProfile.parse(input, reserved)
    expect(p.fields).toEqual({
      ...input,
      chineseName: "王小明",
      studentId: null,
      phone: "0912345678",
      nycuEmail: "x@nycu.edu.tw",
    })
  })
  test.each([
    ["birthday", "2027-02-30"],
    ["birthday", "1899-12-31"],
    ["birthday", "2001/02/03"],
    ["phone", "0812345678"],
    ["chinese_name", "王".repeat(33)],
    ["first_name", ""],
    ["line_id", "x".repeat(65)],
  ])("rejects %p = %p", async (field, value) => {
    const key = {
      birthday: "birthday",
      phone: "phone",
      chinese_name: "chineseName",
      first_name: "firstName",
      line_id: "lineId",
    }[field]!
    await expect(
      ApplicantProfile.parse({ ...input, [key]: value }, reserved)
    ).rejects.toThrow(refusal("invalid_input", field))
  })
  test("counts code points, not UTF-16 units", async () =>
    expect(
      (
        await ApplicantProfile.parse(
          { ...input, chineseName: "😀".repeat(32) },
          reserved
        )
      ).fields.chineseName
    ).toBe("😀".repeat(32)))
  test("diff lists changed fields only", async () => {
    const a = await ApplicantProfile.parse(input, reserved)
    const b = await ApplicantProfile.parse(
      { ...input, phone: "0987654321" },
      reserved
    )
    expect(a.diff(b)).toEqual({
      phone: { from: "0912345678", to: "0987654321" },
    })
  })
})

describe("ApplicationRefusal", () => {
  test("message is the code with its field", () =>
    expect(refusal("invalid_input", "phone").message).toBe(
      "invalid_input:phone"
    ))
  test("is a Refusal", () =>
    expect(refusal("wrong_state")).toBeInstanceOf(Refusal))
  test("chinese names the field", () =>
    expect(refusal("invalid_input", "phone").chinese).toBe("電話格式不對"))
  test("parseRequestedStatus refuses unknown values", () =>
    expect(() => parseRequestedStatus("phd")).toThrow(
      refusal("invalid_input", "requested_status")
    ))
})
