export const doorPage = {
  label: "Door",
  href: "/door",
  tip: "實驗室的門",
}

/** Four corner links: the door button sits behind the Door crumb. Every
 * member gets the sounds (the pool and the lab's schedule on one page), their
 * greetings and their own record; the voice clips, every card and the full
 * log are door admins' alone. API keys moved to /api-keys. */
export const doorNav = [
  {
    label: "音效",
    href: "/door/sounds",
    tip: "開門時播的音效",
  },
  {
    label: "問候語",
    href: "/door/greetings",
    tip: "開門時門口說的話",
    also: ["/door/voice"],
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

export const greetingTabs = [
  { label: "問候語", href: "/door/greetings" },
  { label: "語音", href: "/door/voice", admin: "door" as const },
]

export const recordTabs = [
  { label: "我的", href: "/door/mine" },
  { label: "全部", href: "/door/log", admin: "door" as const },
]
