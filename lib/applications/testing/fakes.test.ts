import { expect, test } from "bun:test"
import { Email, Username } from "../domain/values"
import { KeycloakUnavailable } from "../ports"
import { FakeKeycloak } from "./fake-keycloak"
import { FakeMailGroups } from "./fakes"
import { FixedClock } from "./clock"
import { SequentialTokens } from "./tokens"
import { NOW } from "./fixtures"

test("FixedClock advances and hands out copies", () => {
  const c = new FixedClock(NOW)
  c.now().setTime(0)
  c.advance(1000)
  expect(c.now()).toEqual(new Date(NOW.getTime() + 1000))
})

test("SequentialTokens hash matches generate", () => {
  const t = new SequentialTokens()
  const g = t.generate()
  expect([
    g.token.length,
    t.hash(g.token).value,
    /^[A-Za-z0-9_-]+$/.test(g.token),
  ]).toEqual([24, g.hash.value, true])
  expect(t.generate().token).not.toBe(g.token)
})

test("FakeMailGroups outcomes", async () => {
  const groups = new FakeMailGroups({
    open: { address: "open@winlab.tw" },
    locked: { address: "locked@winlab.tw", protected: true },
    mine: { address: "mine@winlab.tw", manageable: true },
  })
  const email = Email.parse("a@example.com")
  const yes = { actorId: "u", isManager: async () => true }
  const no = { actorId: "u", isManager: async () => false }
  expect(await groups.add("open", email, yes)).toBe("ok")
  expect(groups.members("open")).toEqual(["a@example.com"])
  expect(await groups.add("open", email, yes)).toBe("already")
  expect(await groups.add("locked", email, yes)).toBe("protected")
  expect(await groups.add("mine", email, no)).toBe("denied")
  groups.failNext("mine")
  expect(await groups.add("mine", email, yes)).toBe("error")
  expect(await groups.add("mine", email, yes)).toBe("ok")
  expect(await groups.add("nope", email, yes)).toBe("error")
})

test("FakeKeycloak fail throws KeycloakUnavailable the given number of times", async () => {
  const kc = new FakeKeycloak()
  kc.fail("hasPassword", 2)
  await expect(kc.hasPassword("x")).rejects.toBeInstanceOf(KeycloakUnavailable)
  await expect(kc.hasPassword("x")).rejects.toBeInstanceOf(KeycloakUnavailable)
  expect(await kc.hasPassword("x")).toBe("user_gone")
  expect(Username.restore("a").value).toBe("a")
})
