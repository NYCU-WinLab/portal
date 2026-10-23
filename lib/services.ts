// Services in groups, each group in alphabetical order. An href that starts
// with https is another lab service and gets the ↗ mark.
export type Service = {
  /** Stable id, stored in home_pins. */
  key: string
  label: string
  name: string
  emoji: string
  href: string
}

export const serviceGroups: { title: string; apps: Service[] }[] = [
  {
    title: "日常",
    apps: [
      {
        key: "bento",
        label: "Bento",
        name: "便當",
        emoji: "🍱",
        href: "/bento",
      },
      {
        key: "bulletin",
        label: "Bulletin",
        name: "公告",
        emoji: "📢",
        href: "/bulletin",
      },
      { key: "door", label: "Door", name: "門禁", emoji: "🚪", href: "/door" },
      {
        key: "gallery",
        label: "Gallery",
        name: "相簿",
        emoji: "🖼️",
        href: "https://gallery.winlab.tw",
      },
      {
        key: "games",
        label: "Games",
        name: "遊戲",
        emoji: "🎮",
        href: "/games",
      },
      {
        key: "leave",
        label: "Leave",
        name: "請假",
        emoji: "🏖️",
        href: "/leave",
      },
      {
        key: "meetings",
        label: "Meetings",
        name: "實驗室會議",
        emoji: "🗓️",
        href: "/meetings",
      },
      {
        key: "rooms",
        label: "Rooms",
        name: "借會議室",
        emoji: "🏢",
        href: "/rooms",
      },
    ],
  },
  {
    title: "行政",
    apps: [
      {
        key: "approve",
        label: "Approve",
        name: "簽核",
        emoji: "✍️",
        href: "/approve",
      },
      {
        key: "receipts",
        label: "Receipts",
        name: "收據",
        emoji: "🧾",
        href: "/receipts",
      },
      {
        key: "reimburse",
        label: "Reimburse",
        name: "記帳",
        emoji: "💰",
        href: "/reimburse",
      },
      {
        key: "trip",
        label: "Trip",
        name: "出差文件",
        emoji: "✈️",
        href: "/trip",
      },
    ],
  },
  {
    title: "帳號",
    apps: [
      {
        key: "admins",
        label: "Admins",
        name: "管理員",
        emoji: "🛡️",
        href: "/admins",
      },
      {
        key: "developers",
        label: "Developers",
        name: "開發者應用",
        emoji: "🧩",
        href: "/developers",
      },
      {
        key: "groups",
        label: "Groups",
        name: "群組信",
        emoji: "👥",
        href: "/groups",
      },
      {
        key: "profile",
        label: "Profile",
        name: "個人資料",
        emoji: "👤",
        href: "/profile",
      },
    ],
  },
  {
    title: "工具",
    apps: [
      {
        key: "carrel",
        label: "Carrel",
        name: "虛擬機",
        emoji: "🖥️",
        href: "https://carrel.winlab.tw",
      },
      {
        key: "github",
        label: "GitHub",
        name: "程式碼",
        emoji: "🐙",
        href: "https://github.com/NYCU-WinLab",
      },
      {
        key: "gitlab",
        label: "GitLab",
        name: "程式碼",
        emoji: "🦊",
        href: "https://gitlab.winlab.tw",
      },
      {
        key: "llm",
        label: "LLM",
        name: "語言模型",
        emoji: "🤖",
        href: "https://llm.winlab.tw",
      },
      {
        key: "nextcloud",
        label: "Nextcloud",
        name: "雲端硬碟",
        emoji: "☁️",
        href: "https://nextcloud.winlab.tw",
      },
      {
        key: "transcribe",
        label: "Transcribe",
        name: "逐字稿",
        emoji: "📝",
        href: "https://transcribe.winlab.tw",
      },
      {
        key: "video",
        label: "Video",
        name: "影片",
        emoji: "🎬",
        href: "https://video.winlab.tw",
      },
      {
        key: "wiki",
        label: "Wiki",
        name: "文件庫",
        emoji: "📚",
        href: "https://wiki.winlab.tw",
      },
    ],
  },
]

export const services = serviceGroups.flatMap((group) => group.apps)

export const isServiceKey = (key: string) =>
  services.some((service) => service.key === key)
