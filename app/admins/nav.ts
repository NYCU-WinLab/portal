export const adminsPage = {
  label: "Admins",
  href: "/admins",
  tip: "各 app 的管理員",
}

/** Everyone sees who the admins are; the IP list is portal admins'. */
export const adminsNav = [
  { label: "管理員", href: "/admins", tip: "各 app 的管理員" },
  {
    label: "IP 使用者",
    href: "/admins/ip-users",
    tip: "網段位址登記",
    admin: "portal" as const,
  },
]
