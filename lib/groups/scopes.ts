// The OAuth scopes the portal-groups token is minted with. Kept apart from
// google-auth.ts (server-only) so a test can pin them. The custom admin role
// CAN change group settings (GROUPS_UPDATE can't be split from membership),
// so these scopes are the only thing keeping this token off them: widening
// them to the full group scope is a security change, not a tweak.

export const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member",
]
