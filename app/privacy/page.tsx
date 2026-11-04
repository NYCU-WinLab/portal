import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"

// Public: Google's consent screen links here, and visitors need not be
// signed in to read it.

export const metadata = { title: "隱私權" }

const sections = [
  {
    title: "誰能用",
    items: ["Portal 是 WinLab 實驗室的內部系統，只有實驗室成員能登入。"],
  },
  {
    title: "Google 行事曆",
    items: [
      "你連結後，Portal 只讀取主要行事曆的活動時間、標題與地點。",
      "選「只顯示忙碌」時，其他成員只看得到忙碌時段。",
      "選「公開標題與地點」時，成員也看得到標題與地點。",
      "你在 Google 設為私人的活動，一律只顯示忙碌。",
      "Portal 不修改、不刪除你的 Google 行事曆。",
    ],
  },
  {
    title: "資料保存",
    items: [
      "Google 授權憑證加密存放在實驗室自己的伺服器。",
      "資料不提供給實驗室以外的人，也不用於廣告。",
      "取消連結或離開實驗室後，Portal 刪除你的行事曆資料。",
      "Portal's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
    ],
  },
  {
    title: "聯絡",
    items: ["winlab@winlab.tw"],
  },
]

export default function PrivacyPage() {
  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title="隱私權" />
        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <SectionHeader title={section.title} />
            <ul className="flex flex-col gap-2">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PortalShell>
  )
}
