export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Every member gets the door, the sound pool, the greeting schedule and
 * their API keys; the log is door admins' alone. */
export const doorNav = (admin: boolean) => [
  { label: "開門", href: "/door", tip: "按一下開門" },
  { label: "音效", href: "/door/sounds", tip: "開門時播的音效" },
  { label: "問候語", href: "/door/greetings", tip: "門口依時段說的話" },
  { label: "金鑰", href: "/door/tokens", tip: "用 API 開門" },
  ...(admin ? [{ label: "紀錄", href: "/door/log", tip: "誰開了門" }] : []),
]
