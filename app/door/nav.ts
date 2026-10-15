export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Only door admins get a nav: the log is theirs alone. */
export const doorAdminNav = [
  { label: "開門", href: "/door", tip: "按一下開門" },
  { label: "紀錄", href: "/door/log", tip: "誰開了門" },
]
