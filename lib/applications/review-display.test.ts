import { describe, expect, test } from "bun:test"

import { REFUSAL_CODES, ApplicationRefusal } from "./domain/refusal"
import {
  actorName,
  awaitsPassword,
  eventDetail,
  profilePatch,
  refusalText,
  retryChange,
  stepRows,
  taipeiTime,
} from "./review-display"
import type { ProfileView, ReviewItem } from "./views"

type Event = ReviewItem["events"][number]
const event = (over: Partial<Event>): Event => ({
  id: 1,
  kind: "accepted",
  actorKind: "admin",
  actorId: "u1",
  changes: null,
  at: "2026-11-26T06:00:00.000Z",
  ...over,
})

describe("actorName", () => {
  const names = new Map([["u1", "王小明"]])

  test("applicant and system", () => {
    expect(
      actorName(event({ actorKind: "applicant", actorId: null }), names)
    ).toBe("申請人")
    expect(
      actorName(event({ actorKind: "system", actorId: null }), names)
    ).toBe("系統")
  })

  test("a processor by name, a deleted one as such", () => {
    expect(actorName(event({}), names)).toBe("王小明")
    expect(actorName(event({ actorId: null }), names)).toBe("已刪除的處理者")
    expect(actorName(event({ actorId: "u2" }), names)).toBe("處理者")
  })
})

describe("refusalText", () => {
  test("every code has Chinese text", () => {
    for (const code of REFUSAL_CODES) {
      const text = refusalText(new ApplicationRefusal(code))
      expect(text).toBeTruthy()
      expect(text).not.toContain(code)
    }
  })

  test("a version conflict asks to reload", () => {
    expect(refusalText(new ApplicationRefusal("version_conflict"))).toContain(
      "重新整理"
    )
  })

  test("a missing cohort group says the portal admins were told", () => {
    expect(
      refusalText(new ApplicationRefusal("cohort_group_missing"))
    ).toContain("已通知")
  })

  test("a field is named", () => {
    expect(refusalText(new ApplicationRefusal("invalid_input", "phone"))).toBe(
      "電話格式不對"
    )
  })

  test("other errors are not ours", () => {
    expect(refusalText(new Error("x"))).toBeNull()
    expect(refusalText("x")).toBeNull()
  })
})

describe("eventDetail", () => {
  test("names the fields an edit changed", () => {
    expect(
      eventDetail(
        event({
          kind: "edited",
          changes: {
            phone: { from: "0911111111", to: "0922222222" },
            requested_status: { from: "master", to: "doctoral" },
          },
        })
      )
    ).toBe("改了電話、申請身分")
  })

  test("a retry with new values shows them", () => {
    expect(
      eventDetail(
        event({
          kind: "provision_retried",
          changes: {
            username: { from: "xmwang", to: "xmwang2" },
            cohort: { from: 116, to: 115 },
          },
        })
      )
    ).toBe("username xmwang → xmwang2，學年度 116 → 115")
  })

  test("a provisioning step and error", () => {
    expect(
      eventDetail(
        event({
          kind: "provision_failed",
          changes: { step: "create_account", error: "timeout" },
        })
      )
    ).toBe("建立帳號：timeout")
  })

  test("nothing to add", () => {
    expect(eventDetail(event({ kind: "submitted", changes: null }))).toBeNull()
  })
})

describe("stepRows", () => {
  const base = {
    attempts: 0,
    nextAt: "2026-11-26T06:00:00.000Z",
    error: null,
    blockedAt: null,
    startedAt: "2026-11-26T06:00:00.000Z",
    finishedAt: null,
    releasedAt: null,
    steps: [
      {
        name: "create_account" as const,
        completedAt: "2026-11-26T06:01:00.000Z",
      },
    ],
  }

  test("done steps, the next one running, the rest waiting", () => {
    expect(stepRows(base).map((s) => s.state)).toEqual([
      "done",
      "running",
      "waiting",
      "waiting",
      "waiting",
    ])
  })

  test("blocked marks the next step blocked", () => {
    const rows = stepRows({ ...base, blockedAt: base.nextAt, error: "no" })
    expect(rows[1]?.state).toBe("blocked")
  })

  test("a failed attempt marks the next step failed", () => {
    const rows = stepRows({ ...base, attempts: 2, error: "timeout" })
    expect(rows[1]?.state).toBe("failed")
  })
})

describe("profilePatch", () => {
  const current: ProfileView = {
    username: "xmwang",
    chineseName: "王小明",
    firstName: "Xiaoming",
    lastName: "Wang",
    studentId: null,
    birthday: "2000-01-01",
    phone: "0911111111",
    nycuEmail: "x@nycu.edu.tw",
    department: "資工",
    lineId: "xm",
  }

  test("only the changed fields, trimmed; blank optional clears", () => {
    expect(
      profilePatch(current, {
        ...current,
        studentId: " 311551000 ",
        nycuEmail: "",
        phone: "0911111111",
        chineseName: "王小名",
      })
    ).toEqual({
      studentId: "311551000",
      nycuEmail: null,
      chineseName: "王小名",
    })
  })

  test("an untouched optional stays out", () => {
    expect(profilePatch(current, { ...current, studentId: "" })).toEqual({})
  })
})

describe("retryChange", () => {
  test("only values that differ", () => {
    expect(
      retryChange(
        { username: "a", cohort: 116 },
        { username: " a ", cohort: "116" }
      )
    ).toEqual({})
    expect(
      retryChange(
        { username: "a", cohort: 116 },
        { username: "b", cohort: "115" }
      )
    ).toEqual({ username: "b", cohort: 115 })
  })

  test("a field left out stays out", () => {
    expect(
      retryChange({ username: "a", cohort: 116 }, { cohort: "117" })
    ).toEqual({
      cohort: 117,
    })
  })
})

describe("awaitsPassword", () => {
  test("accepted, password mail not yet used", () => {
    const mail = {
      lastSentAt: null,
      expiresAt: null,
      passwordSet: false,
      canResend: true,
    }
    expect(awaitsPassword({ status: "accepted", passwordMail: mail })).toBe(
      true
    )
    expect(
      awaitsPassword({
        status: "accepted",
        passwordMail: { ...mail, passwordSet: true },
      })
    ).toBe(false)
    expect(awaitsPassword({ status: "pending", passwordMail: null })).toBe(
      false
    )
  })
})

test("taipeiTime", () => {
  expect(taipeiTime("2026-11-26T06:05:00.000Z")).toBe("2026-11-26 14:05")
})
