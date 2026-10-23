export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Every member gets the door and the sound pool; the log is door admins'
 * alone. */
export const doorNav = (admin: boolean) => [
  { label: "開門", href: "/door", tip: "按一下開門" },
  { label: "音效", href: "/door/sounds", tip: "開門時播的音效" },
  ...(admin ? [{ label: "紀錄", href: "/door/log", tip: "誰開了門" }] : []),
]
