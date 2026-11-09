// The apps an API key can be allowed into, named as on the home page. Each
// action belongs to one of them in lib/actions/registry.ts, or to none:
// actions that manage access (admins, developer apps, API keys, door
// cards, mail group managers) stay off API keys, so a leaked key cannot
// make more keys or grant rights that outlive its revocation.
export const apiApps = {
  profile: "個人資料",
  members: "成員",
  bulletin: "公告",
  leave: "請假",
  calendar: "行事曆",
  meetings: "會議",
  door: "開門",
  greetings: "門口問候",
  bento: "便當",
  music: "點歌",
  games: "遊戲",
  approve: "簽核",
  assets: "財產",
  receipts: "收據",
  reimburse: "記帳",
  trip: "出差文件",
  groups: "群組信",
  invitations: "邀請信",
} as const

export type ApiApp = keyof typeof apiApps
export const apiAppKeys = Object.keys(apiApps) as [ApiApp, ...ApiApp[]]

// The apps a service key can be allowed into: their actions never act as a
// person (no profile, no "mine"), so a key that belongs to nobody can run
// them. Add an app here only when every action in it is like that.
export const serviceApps = ["invitations"] as const satisfies ApiApp[]
export type ServiceApp = (typeof serviceApps)[number]

/** The curl line that runs one action with a key, shown on /api-keys. */
export const curlLine = (token: string, action: string) =>
  `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{}' https://portal.winlab.tw/api/actions/${action}`

/** The curl line that lists what a key can call; it works for any key. */
export const listLine = (token: string) =>
  `curl -H "Authorization: Bearer ${token}" https://portal.winlab.tw/api/actions`
