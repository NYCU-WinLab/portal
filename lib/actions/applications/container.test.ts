import { describe, expect, test } from "bun:test"

import { productionDeps } from "@/lib/actions/applications/container"

describe("productionDeps", () => {
  test("builds without the Keycloak setting", () => {
    const saved = process.env.KEYCLOAK_ISSUER
    delete process.env.KEYCLOAK_ISSUER
    try {
      expect(() => productionDeps()).not.toThrow()
    } finally {
      if (saved !== undefined) process.env.KEYCLOAK_ISSUER = saved
    }
  })
})
