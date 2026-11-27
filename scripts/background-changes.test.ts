import { describe, expect, test } from "bun:test"

import { appOfChange, backgroundChanges } from "@/lib/actions/registry"

describe("application background changes", () => {
  test.each(["lab_application_provisioning", "lab_application_retention"])(
    "%s is registered and stays off API keys",
    (name) => {
      expect(Object.hasOwn(backgroundChanges, name)).toBe(true)
      expect(backgroundChanges[name]).toBeNull()
      expect(appOfChange(name)).toBeNull()
    }
  )
})
