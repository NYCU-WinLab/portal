/**
 * Apps that have admins, and what members call them. "portal" is the whole
 * site: a portal admin is an admin of every app.
 */
export const adminApps = {
  portal: "全站",
  bento: "便當",
  meetings: "實驗室會議",
  receipts: "收據",
  reimburse: "記帳",
  trip: "出差",
  approve: "簽核",
  door: "門禁",
} as const

export type AdminApp = keyof typeof adminApps

/** Apps a portal admin does not administer by rank: their data is personal
 * (trip files carry members' signatures), so only the app's own admins
 * see it. */
export const ownAdminsOnly: readonly AdminApp[] = ["trip"]
export const adminAppKeys = Object.keys(adminApps) as [AdminApp, ...AdminApp[]]
