import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"

// Public: the homepage on Google's consent screen. It says what the portal
// is and links the privacy page, without signing in.

export const metadata = { title: "關於 WinLab Portal" }

export default function AboutPage() {
  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title="WinLab Portal" />
        <section className="flex flex-col gap-2">
          <SectionHeader title="關於" />
          <p>
            WinLab Portal
            是國立陽明交通大學無線網路實驗室（WinLab）的內部系統，成員用它請假、訂會議室、點便當與看行事曆。
          </p>
          <p>
            行事曆：成員可以連結自己的 Google
            行事曆，讓實驗室知道他什麼時候忙碌。每位成員自己決定只顯示忙碌，或公開標題與地點。
          </p>
        </section>
        <section className="flex flex-col gap-2" lang="en">
          <SectionHeader title="About" />
          <p>
            WinLab Portal is the internal web app of the Wireless Internet Lab
            (WinLab) at National Yang Ming Chiao Tung University. Lab members
            sign in with the lab account to request leave, book meeting rooms,
            order lunch and see each other&apos;s availability.
          </p>
          <p>
            Calendar: a member may link their Google Calendar. The portal reads
            the events on their primary calendar (time, title, location) with
            read-only access, and shows the lab when they are busy. Each member
            chooses whether others see only busy blocks or also titles and
            locations. The portal never changes or deletes calendar events, and
            members can unlink at any time.
          </p>
        </section>
        <nav className="flex gap-4">
          <Link href="/privacy" className="underline">
            隱私權 Privacy
          </Link>
          <Link href="/" className="underline">
            成員登入 Sign in
          </Link>
        </nav>
      </div>
    </PortalShell>
  )
}
