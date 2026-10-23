export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Every member gets the door, the sound pool and their API keys; the
 * greeting pool, the voice clips and the log are door admins' alone. */
export const doorNav = [
  { label: "開門", href: "/door", tip: "按一下開門" },
  { label: "音效", href: "/door/sounds", tip: "開門時播的音效" },
  { label: "金鑰", href: "/door/tokens", tip: "用 API 開門" },
  {
    label: "問候語",
    href: "/door/greetings",
    tip: "門口依時段隨機說的話",
    admin: "door" as const,
  },
  {
    label: "語音",
    href: "/door/voice",
    tip: "門口念的每一句",
    admin: "door" as const,
  },
  {
    label: "紀錄",
    href: "/door/log",
    tip: "誰開了門",
    admin: "door" as const,
  },
]
