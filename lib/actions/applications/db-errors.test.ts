import { describe, expect, test } from "bun:test"
import { DrizzleQueryError } from "drizzle-orm"

import { withoutParams } from "@/lib/actions/applications/db-errors"
import { DbReservedNames } from "@/lib/actions/applications/reserved-names"
import {
  DrizzleApplicationStore,
  uniqueViolation,
} from "@/lib/actions/applications/store"
import { MailRatePolicy } from "@/lib/applications/domain/policies"
import { ApplicationRefusal } from "@/lib/applications/domain/refusal"
import type { Db } from "@/lib/db"

const EMAIL = "applicant@example.com"

function queryError(cause?: Record<string, unknown>) {
  const pg = cause && Object.assign(new Error("pg says no"), cause)
  return new DrizzleQueryError(
    'select "id" from "lab_applications" where "email" = $1',
    [EMAIL, "王小明"],
    pg
  )
}

/** Every text a span or the apply site's 400 could get from the error. */
const visible = (e: Error) => [e.name, e.message, e.stack ?? ""].join("\n")

/** A Db whose every call throws the given error. */
function failingDb(error: Error): Db {
  const fail = () => {
    throw error
  }
  return new Proxy({}, { get: () => fail }) as unknown as Db
}

describe("withoutParams", () => {
  test("drops the query and its params, keeps code and constraint", () => {
    const original = queryError({
      code: "23505",
      constraint: "lab_application_tokens_token_hash_key",
      detail: `Key (email)=(${EMAIL}) already exists.`,
    })
    const e = withoutParams(original) as Error
    expect(e).toBeInstanceOf(Error)
    expect(visible(e)).not.toContain(EMAIL)
    expect(visible(e)).not.toContain("王小明")
    expect(visible(e)).not.toContain("select")
    expect(e.message).toContain("23505")
    expect(e.message).toContain("lab_application_tokens_token_hash_key")
    // The pg error stays as cause, so callers can still read the code.
    expect(e.cause).toBe(original.cause)
    expect(uniqueViolation(e)).toBe("lab_application_tokens_token_hash_key")
  })

  test("a deadlock keeps its code", () => {
    const e = withoutParams(queryError({ code: "40P01" })) as Error
    expect(e.message).toContain("40P01")
    expect(visible(e)).not.toContain(EMAIL)
  })

  test("without a pg cause it still hides the params", () => {
    const e = withoutParams(queryError()) as Error
    expect(visible(e)).not.toContain(EMAIL)
    expect(e.cause).toBeUndefined()
  })

  test("any other error is returned as it is", () => {
    const refusal = new ApplicationRefusal("rate_limited")
    expect(withoutParams(refusal)).toBe(refusal)
    const plain = new Error("save failed: username_claimed")
    expect(withoutParams(plain)).toBe(plain)
    expect(withoutParams("text")).toBe("text")
  })
})

describe("the Drizzle stores throw without params", () => {
  const opts = { rate: new MailRatePolicy(), hashSecret: () => "s" }

  test("transaction", async () => {
    const store = new DrizzleApplicationStore(
      failingDb(queryError({ code: "40P01" })),
      opts
    )
    const e = (await store
      .transaction(async () => null)
      .catch((x: unknown) => x)) as Error
    expect(e.message).toContain("40P01")
    expect(visible(e)).not.toContain(EMAIL)
  })

  test("reader", async () => {
    const store = new DrizzleApplicationStore(
      failingDb(queryError({ code: "57014" })),
      opts
    )
    const e = (await store.reader
      .history({ value: EMAIL } as never, "id")
      .catch((x: unknown) => x)) as Error
    expect(e.message).toContain("57014")
    expect(visible(e)).not.toContain(EMAIL)
  })

  test("reserved names", async () => {
    const names = new DbReservedNames(
      failingDb(queryError({ code: "57014" })),
      async () => new Set()
    )
    const e = (await names.has("xmwang").catch((x: unknown) => x)) as Error
    expect(e.message).toContain("57014")
    expect(visible(e)).not.toContain(EMAIL)
  })
})
