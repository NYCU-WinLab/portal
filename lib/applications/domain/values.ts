import {
  BIRTHDAY_RANGE,
  EMAIL_PATTERN,
  COHORT_RANGE,
  LAB_STATUSES,
  LIMITS,
  PHONE_PATTERN,
  REQUESTED_STATUSES,
  TOKEN_HASH_PATTERN,
  USERNAME_PATTERN,
  type LabStatus,
  type RequestedStatus,
} from "./constants"
import { ApplicationRefusal } from "./refusal"

export type ReservedNameSet = { has(name: string): Promise<boolean> }

const invalid = (field: string) =>
  new ApplicationRefusal("invalid_input", field)
const length = (s: string) => [...s].length

export class Email {
  private constructor(readonly value: string) {
    Object.freeze(this)
  }

  static parse(raw: string, field = "email"): Email {
    const s = raw.trim().toLowerCase()
    if (
      length(s) < 1 ||
      length(s) > LIMITS.email ||
      !new RegExp(EMAIL_PATTERN).test(s)
    ) {
      throw invalid(field)
    }
    return new Email(s)
  }

  static restore(v: string): Email {
    return new Email(v)
  }

  /**
   * Key for rate limits: anything after a plus is dropped on every domain,
   * since most providers deliver plus tags to the same mailbox; Gmail also
   * ignores dots.
   */
  rateKey(): string {
    const [local, domain] = this.value.split("@")
    const base = local.split("+")[0]
    if (domain !== "gmail.com" && domain !== "googlemail.com")
      return `${base}@${domain}`
    return `${base.replaceAll(".", "")}@gmail.com`
  }

  equals(o: Email): boolean {
    return this.value === o.value
  }
}

export class Username {
  private constructor(readonly value: string) {
    Object.freeze(this)
  }

  static async parse(
    raw: string,
    reserved: ReservedNameSet
  ): Promise<Username> {
    const s = raw.trim()
    if (!new RegExp(USERNAME_PATTERN).test(s) || (await reserved.has(s))) {
      throw invalid("username")
    }
    return new Username(s)
  }

  static restore(v: string): Username {
    return new Username(v)
  }
}

export class Cohort {
  private constructor(readonly value: number) {
    Object.freeze(this)
  }

  static parse(n: number): Cohort {
    if (!Number.isInteger(n) || n < COHORT_RANGE[0] || n > COHORT_RANGE[1])
      throw invalid("cohort")
    return new Cohort(n)
  }

  static restore(n: number): Cohort {
    return new Cohort(n)
  }

  /** The Keycloak group of the cohort, e.g. `/lab-member/116`. */
  get groupPath(): string {
    return `/lab-member/${this.value}`
  }

  /** The cohort of the academic year that starts each September, Taipei time. */
  static defaultFor(at: Date): Cohort {
    const taipei = new Date(at.getTime() + 8 * 3600_000)
    const y = taipei.getUTCFullYear()
    const academicYear = taipei.getUTCMonth() + 1 >= 9 ? y : y - 1
    return new Cohort(academicYear - 1911 + 1)
  }
}

export class TokenHash {
  private constructor(readonly value: string) {
    Object.freeze(this)
  }

  static parse(hex: string): TokenHash {
    if (!new RegExp(TOKEN_HASH_PATTERN).test(hex)) throw invalid("token_hash")
    return new TokenHash(hex)
  }
}

export type ProfileInput = {
  username: string
  chineseName: string
  firstName: string
  lastName: string
  studentId?: string | null
  birthday: string
  phone: string
  nycuEmail?: string | null
  department: string
  lineId: string
}

export type ProfileFields = {
  username: string
  chineseName: string
  firstName: string
  lastName: string
  studentId: string | null
  birthday: string
  phone: string
  nycuEmail: string | null
  department: string
  lineId: string
}

const SNAKE: Record<keyof ProfileFields, string> = {
  username: "username",
  chineseName: "chinese_name",
  firstName: "first_name",
  lastName: "last_name",
  studentId: "student_id",
  birthday: "birthday",
  phone: "phone",
  nycuEmail: "nycu_email",
  department: "department",
  lineId: "line_id",
}

function text(raw: string, field: string, max: number): string {
  const s = raw.trim()
  if (length(s) < 1 || length(s) > max) throw invalid(field)
  // Control and invisible format characters are refused; a zero width
  // joiner stays so emoji sequences survive.
  if (/[\p{Cc}\p{Cf}]/u.test(s.replace(/\u200d/g, ""))) throw invalid(field)
  return s
}

function optionalText(
  raw: string | null | undefined,
  field: string,
  max: number
): string | null {
  const s = (raw ?? "").trim()
  return s === "" ? null : text(s, field, max)
}

function birthday(raw: string): string {
  const s = raw.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw invalid("birthday")
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  // Round-trip catches dates that do not exist, such as 2027-02-30.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    throw invalid("birthday")
  }
  if (s < BIRTHDAY_RANGE[0] || s > BIRTHDAY_RANGE[1]) throw invalid("birthday")
  return s
}

export class ApplicantProfile {
  readonly fields: Readonly<ProfileFields>

  private constructor(fields: ProfileFields) {
    this.fields = Object.freeze({ ...fields })
    Object.freeze(this)
  }

  static async parse(
    input: ProfileInput,
    reserved: ReservedNameSet
  ): Promise<ApplicantProfile> {
    const username = (await Username.parse(input.username, reserved)).value
    const phone = input.phone.replace(/[\s-]/g, "")
    if (!new RegExp(PHONE_PATTERN).test(phone)) throw invalid("phone")
    const nycu = (input.nycuEmail ?? "").trim()
    return new ApplicantProfile({
      username,
      chineseName: text(input.chineseName, "chinese_name", LIMITS.chineseName),
      firstName: text(input.firstName, "first_name", LIMITS.firstName),
      lastName: text(input.lastName, "last_name", LIMITS.lastName),
      studentId: optionalText(input.studentId, "student_id", LIMITS.studentId),
      birthday: birthday(input.birthday),
      phone,
      nycuEmail: nycu === "" ? null : Email.parse(nycu, "nycu_email").value,
      department: text(input.department, "department", LIMITS.department),
      lineId: text(input.lineId, "line_id", LIMITS.lineId),
    })
  }

  /** Rebuilds from the database without validating again. */
  static restore(fields: ProfileFields): ApplicantProfile {
    return new ApplicantProfile(fields)
  }

  diff(next: ApplicantProfile): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of Object.keys(SNAKE) as (keyof ProfileFields)[]) {
      if (this.fields[key] !== next.fields[key]) {
        out[SNAKE[key]] = { from: this.fields[key], to: next.fields[key] }
      }
    }
    return out
  }
}

export function parseRequestedStatus(raw: string): RequestedStatus {
  if (!(REQUESTED_STATUSES as readonly string[]).includes(raw))
    throw invalid("requested_status")
  return raw as RequestedStatus
}

export function parseLabStatus(raw: string): LabStatus {
  if (!(LAB_STATUSES as readonly string[]).includes(raw))
    throw invalid("status")
  return raw as LabStatus
}

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Where the apply site lives: https on the lab's own domain, origin only.
 * The default port (https://winlab.tw:443) is accepted on purpose: the URL
 * parser drops it, so the stored origin has no port.
 */
export const ApplySiteUrl = {
  parse(raw: string): string {
    const field = "apply_site_url"
    const text = raw.trim()
    // An empty "?" or "#" leaves url.search and url.hash empty.
    if (text.includes("?") || text.includes("#")) throw invalid(field)
    let url: URL
    try {
      url = new URL(text)
    } catch {
      throw invalid(field)
    }
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search !== "" ||
      url.hash !== "" ||
      !(host === "winlab.tw" || host.endsWith(".winlab.tw")) ||
      !host.split(".").every((label) => HOST_LABEL.test(label))
    )
      throw invalid(field)
    return url.origin
  },
}
