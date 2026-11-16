export const keysPage = {
  label: "Keys",
  href: "/keys",
  tip: "登入機器用的 SSH 金鑰",
}

/** Everyone keeps their own keys; the services are portal admins'. */
export const keysNav = [
  { label: "我的金鑰", href: "/keys", tip: "登入機器用的 SSH 金鑰" },
  {
    label: "服務",
    href: "/keys/services",
    tip: "哪些機器讀金鑰",
    admin: "portal" as const,
  },
]

/** The curl line a service's machine reads its keys with, as
 * authorized_keys text. */
export const serviceLine = (token: string, slug: string) =>
  `curl -H "Authorization: Bearer ${token}" "https://portal.winlab.tw/api/ssh-keys/services/${slug}?format=text"`

/** The line that encrypts a file to a member with their keys. */
export const memberLine = (token: string, username: string) =>
  `curl -H "Authorization: Bearer ${token}" "https://portal.winlab.tw/api/ssh-keys/members/${username}?format=text" | age -R - -o secret.age secret.txt`

export const day = (date: Date) =>
  date.toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
