export const applicationsPage = {
  label: "Applications",
  href: "/applications",
  tip: "審核帳號申請",
}

/** Only accounts admins, the processors, have anything here. */
export const applicationsNav = [
  {
    label: "申請",
    href: "/applications",
    tip: "待處理與已結案的申請",
    admin: "accounts" as const,
  },
  {
    label: "設定",
    href: "/applications/settings",
    tip: "通知對象、預設群組信、申請網站",
    admin: "accounts" as const,
  },
]
