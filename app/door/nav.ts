export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Every member gets the door, the sound pool, their greetings and their
 * own cards and openings; the voice clips, every card and the full log are
 * door admins' alone. API keys
 * moved to /api-keys. */
export const doorNav = [
  { label: "開門", href: "/door", tip: "按一下開門" },
  { label: "音效", href: "/door/sounds", tip: "開門時播的音效" },
  {
    label: "問候語",
    href: "/door/greetings",
    tip: "門口依時段跟你說的話",
  },
  {
    label: "我的紀錄",
    href: "/door/mine",
    tip: "我的門禁卡與開門紀錄",
  },
  {
    label: "語音",
    href: "/door/voice",
    tip: "門口念的每一句",
    admin: "door" as const,
  },
  {
    label: "門禁卡",
    href: "/door/cards",
    tip: "誰的卡刷得進門",
    admin: "door" as const,
  },
  {
    label: "紀錄",
    href: "/door/log",
    tip: "誰開了門",
    admin: "door" as const,
  },
]
