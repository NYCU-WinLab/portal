import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listAnnouncements } from "@/lib/actions/bulletin"
import { runAction } from "@/lib/actions/define"
import { getNextMeeting } from "@/lib/actions/meetings"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName } from "@/lib/names"

import { NextMeeting } from "./meetings/next-meeting"

export const dynamic = "force-dynamic"

// Services in groups, each group in alphabetical order. An href that starts
// with https is another lab service and gets the ↗ mark.
const groups = [
  {
    title: "日常",
    apps: [
      { label: "Bento", name: "便當", emoji: "🍱", href: "/bento" },
      { label: "Bulletin", name: "公告", emoji: "📢", href: "/bulletin" },
      { label: "Door", name: "門禁", emoji: "🚪", href: "/door" },
      {
        label: "Gallery",
        name: "相簿",
        emoji: "🖼️",
        href: "https://gallery.winlab.tw",
      },
      { label: "Games", name: "遊戲", emoji: "🎮", href: "/games" },
      { label: "Leave", name: "請假", emoji: "🏖️", href: "/leave" },
      { label: "Meetings", name: "實驗室會議", emoji: "🗓️", href: "/meetings" },
      { label: "Rooms", name: "借會議室", emoji: "🏢", href: "/rooms" },
    ],
  },
  {
    title: "行政",
    apps: [
      { label: "Approve", name: "簽核", emoji: "✍️", href: "/approve" },
      { label: "Receipts", name: "收據", emoji: "🧾", href: "/receipts" },
      { label: "Reimburse", name: "記帳", emoji: "💰", href: "/reimburse" },
      { label: "Trip", name: "出差文件", emoji: "✈️", href: "/trip" },
    ],
  },
  {
    title: "帳號",
    apps: [
      { label: "Admins", name: "管理員", emoji: "🛡️", href: "/admins" },
      {
        label: "Developers",
        name: "開發者應用",
        emoji: "🧩",
        href: "/developers",
      },
      { label: "Groups", name: "群組信", emoji: "👥", href: "/groups" },
      { label: "Profile", name: "個人資料", emoji: "👤", href: "/profile" },
    ],
  },
  {
    title: "工具",
    apps: [
      {
        label: "Carrel",
        name: "虛擬機",
        emoji: "🖥️",
        href: "https://carrel.winlab.tw",
      },
      {
        label: "GitHub",
        name: "程式碼",
        emoji: "🐙",
        href: "https://github.com/NYCU-WinLab",
      },
      {
        label: "GitLab",
        name: "程式碼",
        emoji: "🦊",
        href: "https://gitlab.winlab.tw",
      },
      {
        label: "LLM",
        name: "語言模型",
        emoji: "🤖",
        href: "https://llm.winlab.tw",
      },
      {
        label: "Nextcloud",
        name: "雲端硬碟",
        emoji: "☁️",
        href: "https://nextcloud.winlab.tw",
      },
      {
        label: "Transcribe",
        name: "逐字稿",
        emoji: "📝",
        href: "https://transcribe.winlab.tw",
      },
      {
        label: "Video",
        name: "影片",
        emoji: "🎬",
        href: "https://video.winlab.tw",
      },
      {
        label: "Wiki",
        name: "文件庫",
        emoji: "📚",
        href: "https://wiki.winlab.tw",
      },
    ],
  },
]

// A post shows on the home page for a week, then lives on /bulletin.
const isFresh = (date: Date) =>
  Date.now() - date.getTime() < 7 * 24 * 3600 * 1000

export default async function Home() {
  const actor = await requireActor("/")
  const [member, { meeting }, { announcements }] = await Promise.all([
    runAction(whoami, actor, {}),
    runAction(getNextMeeting, actor, {}),
    runAction(listAnnouncements, actor, { limit: 1 }),
  ])
  const fresh = announcements.find((post) => isFresh(post.createdAt))

  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title={`Hi, ${givenName(member.name)}`} />
        <NextMeeting meeting={meeting} />
        {fresh && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="公告" />
            <Link
              prefetch
              href="/bulletin"
              className="flex min-h-14 items-center border-b border-border transition-colors duration-state hover:text-muted-foreground"
            >
              {fresh.title}
            </Link>
          </section>
        )}
        {groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <SectionHeader title={group.title} />
            <ul className="flex stagger-rise flex-col">
              {group.apps.map((app) => (
                <li key={app.href} className="border-b border-border">
                  <Link
                    href={app.href}
                    className="flex min-h-14 items-center gap-3 transition-colors duration-state hover:text-muted-foreground"
                  >
                    <span aria-hidden className="w-6 text-center">
                      {app.emoji}
                    </span>
                    {app.label}
                    <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                      {app.name}
                      {app.href.startsWith("https") && (
                        <span aria-label="外部網站">↗</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PortalShell>
  )
}
