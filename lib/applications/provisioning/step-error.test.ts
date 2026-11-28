import { describe, expect, test } from "bun:test"

import { StepError } from "./step-error"

describe("StepError", () => {
  test("retry and blocked carry their reason and flag", () => {
    const retry = StepError.retry("稍後")
    expect(retry.blocked).toBe(false)
    expect(retry.reason).toBe("稍後")
    const blocked = StepError.blocked("無法繼續")
    expect(blocked.blocked).toBe(true)
    expect(blocked.reason).toBe("無法繼續")
  })

  test("from keeps a StepError as it is", () => {
    const e = StepError.blocked("x")
    expect(StepError.from(e)).toBe(e)
  })

  test("from turns anything else into a retry without its text", () => {
    const e = StepError.from(new Error("ECONNRESET secret"))
    expect(e.blocked).toBe(false)
    expect(e.reason).not.toContain("secret")
    expect(StepError.from("secret string").reason).not.toContain("secret")
  })
})
