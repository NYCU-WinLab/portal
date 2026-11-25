import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs"
import { tmpdir } from "os"
import { join } from "path"

const SCRIPT = join(import.meta.dir, "../ssh-keys/portal-keys")
const KEY = "ssh-ed25519 AAAAportalkeystest member"

// Local accounts the stub `id` knows, by uid.
const UIDS: Record<string, number> = {
  root: 0,
  daemon: 1,
  sys999: 999,
  alice: 1000,
  bob: 59999,
  edge: 60000,
  nobody: 65534,
}

let dir: string

const stub = (name: string, body: string) => {
  const path = join(dir, "bin", name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "portal-keys-"))
  mkdirSync(join(dir, "bin"))
  mkdirSync(join(dir, "cache"))
  writeFileSync(join(dir, "token"), "wkk_test\n")
  const cases = Object.entries(UIDS)
    .map(([name, uid]) => `  ${name}) echo ${uid} ;;`)
    .join("\n")
  stub("id", `case $2 in\n${cases}\n  *) exit 1 ;;\nesac`)
  // The portal answers every request with one key.
  stub(
    "curl",
    `while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift ;; esac; shift; done
echo "${KEY}" > "$out"; printf 200`
  )
  stub("logger", `echo "$@" >> "${join(dir, "log")}"`)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const run = (user: string, env: Record<string, string> = {}) => {
  const lines = {
    SERVICE: "b09",
    SHARED: '"p4user"',
    OWN: "yes",
    TOKEN_FILE: join(dir, "token"),
    CACHE_DIR: join(dir, "cache"),
    ...env,
  }
  writeFileSync(
    join(dir, "env"),
    Object.entries(lines)
      .map(([k, v]) => `${k}=${v}\n`)
      .join("")
  )
  const r = Bun.spawnSync(["sh", SCRIPT, user], {
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      PORTAL_KEYS_ENV: join(dir, "env"),
    },
  })
  return { code: r.exitCode, out: r.stdout.toString() }
}

const log = () => {
  try {
    return readFileSync(join(dir, "log"), "utf8")
  } catch {
    return ""
  }
}

describe("portal-keys OWN=yes", () => {
  test("serves a member's own account from uid 1000 to 59999", () => {
    for (const user of ["alice", "bob"]) expect(run(user).out).toContain(KEY)
  })

  test("refuses system accounts under uid 1000", () => {
    for (const user of ["root", "daemon", "sys999"])
      expect(run(user)).toEqual({ code: 0, out: "" })
  })

  test("refuses nobody and other accounts from uid 60000 up", () => {
    for (const user of ["edge", "nobody"])
      expect(run(user)).toEqual({ code: 0, out: "" })
  })

  test("refuses an account that does not exist", () => {
    expect(run("ghost")).toEqual({ code: 0, out: "" })
  })

  test("still serves a shared account without OWN", () => {
    expect(run("p4user", { OWN: "no" }).out).toContain(KEY)
    expect(run("alice", { OWN: "no" }).out).toBe("")
  })
})

describe("portal-keys local failures", () => {
  test("a cache directory it cannot write refuses and says why", () => {
    const r = run("p4user", { CACHE_DIR: join(dir, "missing") })
    expect(r.code).not.toBe(0)
    expect(r.out).toBe("")
    expect(log()).toContain("cannot write to")
    expect(log()).toContain("p4user")
  })

  test("a failed save refuses and says why", () => {
    stub("mv", "exit 1")
    const r = run("p4user")
    expect(r.code).not.toBe(0)
    expect(log()).toContain("cannot save the keys of p4user")
  })

  test("a login that works leaves no log line", () => {
    expect(run("p4user").code).toBe(0)
    expect(log()).toBe("")
  })
})
