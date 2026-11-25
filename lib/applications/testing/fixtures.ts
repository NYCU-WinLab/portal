import {
  Application,
  type AdminActor,
  type Assignment,
  type SubmitInput,
} from "../domain/application"
import {
  ApplicantProfile,
  Cohort,
  Email,
  Username,
  type ProfileInput,
  type ReservedNameSet,
} from "../domain/values"

export const NOW = new Date("2026-11-24T02:00:00.000Z")

export const ADMIN: AdminActor = {
  kind: "admin",
  id: "00000000-0000-4000-8000-000000000001",
}

export const noReservedNames: ReservedNameSet = { has: async () => false }

export function profileInput(overrides?: Partial<ProfileInput>): ProfileInput {
  return {
    username: "xmwang",
    chineseName: "王小明",
    firstName: "Xiao-Ming",
    lastName: "Wang",
    studentId: "312551000",
    birthday: "2001-02-03",
    phone: "0912345678",
    nycuEmail: "xmwang@nycu.edu.tw",
    department: "資工",
    lineId: "xmwang",
    ...overrides,
  }
}

export function profile(
  overrides?: Partial<ProfileInput>
): Promise<ApplicantProfile> {
  return ApplicantProfile.parse(profileInput(overrides), noReservedNames)
}

export async function submitInput(
  overrides?: Partial<SubmitInput>
): Promise<SubmitInput> {
  return {
    id: crypto.randomUUID(),
    email: Email.parse(`a-${crypto.randomUUID().slice(0, 8)}@example.com`),
    requestedStatus: "master",
    profile: await profile(),
    ...overrides,
  }
}

export function assignment(overrides?: Partial<Assignment>): Assignment {
  return {
    status: "master",
    cohort: Cohort.parse(116),
    username: Username.restore("xmwang"),
    mailGroups: [],
    ...overrides,
  }
}

/** An application submitted and confirmed at `at`. */
export async function pending(
  at: Date = NOW,
  overrides?: Partial<SubmitInput>
): Promise<Application> {
  const submitted = Application.submit(await submitInput(overrides), at)
  const confirmed = submitted.next.confirm(at)
  if (confirmed.kind !== "changed") throw new Error("confirm did not change")
  return confirmed.next
}
