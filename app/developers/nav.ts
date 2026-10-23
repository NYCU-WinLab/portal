export const developersPage = {
  label: "Developers",
  href: "/developers",
  tip: "用實驗室帳號登入你的應用程式",
}
export const developersNav = [
  { label: "應用程式", href: "/developers", tip: "你註冊的應用程式" },
  {
    label: "審核",
    href: "/developers/review",
    tip: "Portal 管理員審資料權限",
    admin: "portal" as const,
  },
]
