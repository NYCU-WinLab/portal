/**
 * Apps that have admins, named as on the home page. "portal" is the whole
 * site: a portal admin is an admin of every app.
 */
export const adminApps = {
  portal: "Portal",
  bento: "Bento",
  meetings: "Meetings",
  receipts: "Receipts",
  reimburse: "Reimburse",
  trip: "Trip",
  door: "Door",
} as const

export type AdminApp = keyof typeof adminApps

/** Apps a portal admin does not administer by rank: their data is personal
 * (trip files carry members' signatures), so only the app's own admins
 * see it. */
export const ownAdminsOnly: readonly AdminApp[] = ["trip"]
export const adminAppKeys = Object.keys(adminApps) as [AdminApp, ...AdminApp[]]
