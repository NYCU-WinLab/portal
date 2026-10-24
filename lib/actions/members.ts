import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import {
  type LabStatus,
  labDirectory,
  labStatuses,
  realmAccounts,
} from "@/lib/keycloak"
import { taipeiToday } from "@/lib/leave-dates"
import { gradeLabel } from "@/lib/semester"

// The older `role` attribute, for accounts in no /lab-member status group
// (most alumni). Anything else, such as 待確認, is "other".
const roleStatus: Record<string, LabStatus> = {
  professor: "teacher",
  phd: "doctoral",
  master: "master",
  undergraduate: "undergrad",
  alumni: "alumni",
  assistant: "assistant",
  staff: "assistant",
}

export const memberStatuses = [...labStatuses, "other"] as const
export type MemberStatus = (typeof memberStatuses)[number]

export const listLabMembers = defineAction({
  name: "list_lab_members",
  title: "成員通訊錄",
  description:
    "The lab's member directory from Keycloak: every enabled account except those Keycloak marks as not people (the /system group), current members and alumni. Each has id (Keycloak id), name (Chinese), name_en, username, email, phone, student_id, status (teacher, assistant, doctoral, master, undergrad, alumni or other), cohort (ROC admission year) and title (博三 for students, else the position Keycloak holds). status and cohort come from the /lab-member groups, falling back to the role and admissionYear attributes. Sorted by status, then cohort, then name.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [accounts, directory] = await Promise.all([
      realmAccounts(),
      labDirectory(),
    ])
    const today = taipeiToday()
    const order = new Map(memberStatuses.map((status, i) => [status, i]))
    return accounts
      .map((account) => {
        const attrs = account.attributes
        const grouped = directory.get(account.id)
        const status: MemberStatus =
          grouped?.status ?? roleStatus[attrs.role ?? ""] ?? "other"
        const cohort =
          grouped?.cohort ??
          (attrs.admissionYear ? Number(attrs.admissionYear) : null)
        return {
          id: account.id,
          name: attrs.chinese_name ?? account.username,
          name_en: [account.firstName, account.lastName]
            .filter(Boolean)
            .join(" "),
          username: account.username,
          email: account.email ?? null,
          phone: attrs.phone ?? null,
          student_id: attrs.student_id ?? null,
          status,
          cohort: Number.isFinite(cohort) ? cohort : null,
          title:
            gradeLabel(
              status,
              Number.isFinite(cohort) ? cohort : null,
              today
            ) ??
            attrs.position ??
            null,
        }
      })
      .sort(
        (a, b) =>
          order.get(a.status)! - order.get(b.status)! ||
          (b.cohort ?? 0) - (a.cohort ?? 0) ||
          a.name.localeCompare(b.name, "zh-TW")
      )
  },
})
