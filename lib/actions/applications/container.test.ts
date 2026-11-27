import { describe, expect, test } from "bun:test"

import {
  productionDeps,
  startApplicationProvisioner,
  startApplicationRetention,
} from "@/lib/actions/applications/container"

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

describe("startApplicationProvisioner", () => {
  test("startApplicationProvisioner does nothing without KEYCLOAK_PROVISIONER_*", () => {
    const id = process.env.KEYCLOAK_PROVISIONER_CLIENT_ID
    const secret = process.env.KEYCLOAK_PROVISIONER_CLIENT_SECRET
    delete process.env.KEYCLOAK_PROVISIONER_CLIENT_ID
    delete process.env.KEYCLOAK_PROVISIONER_CLIENT_SECRET
    try {
      expect(() => startApplicationProvisioner()).not.toThrow()
    } finally {
      if (id !== undefined) process.env.KEYCLOAK_PROVISIONER_CLIENT_ID = id
      if (secret !== undefined)
        process.env.KEYCLOAK_PROVISIONER_CLIENT_SECRET = secret
    }
  })

  test("the retention job starter is exported", () => {
    expect(typeof startApplicationRetention).toBe("function")
  })
})
