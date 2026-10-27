export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Three corner links: the door button sits behind the Door crumb, and each
 * link opens a group whose pages switch with DoorTabs. Every member gets the
 * sounds, their greetings and their own record; the voice clips, every card
 * and the full log are door admins' alone. API keys moved to /api-keys. */
export const doorNav = [
  {
    label: "聲音",
    href: "/door/sounds",
    tip: "開門時的音效與問候語",
    also: ["/door/greetings", "/door/voice"],
  },
  {
    label: "紀錄",
    href: "/door/mine",
    tip: "門禁卡與開門紀錄",
    also: ["/door/log"],
  },
  {
    label: "門禁卡",
    href: "/door/cards",
    tip: "誰的卡刷得進門",
    admin: "door" as const,
  },
]

export const soundTabs = [
  { label: "音效", href: "/door/sounds" },
  { label: "問候語", href: "/door/greetings" },
  { label: "語音", href: "/door/voice", admin: "door" as const },
]

export const recordTabs = [
  { label: "我的", href: "/door/mine" },
  { label: "全部", href: "/door/log", admin: "door" as const },
]
