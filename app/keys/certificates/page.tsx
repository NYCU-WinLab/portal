import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { requireActor } from "@/lib/auth/session"

import { CopyKey } from "../key-forms"
import { keysNav, keysPage } from "../nav"

export const dynamic = "force-dynamic"

// How a member logs in with a lab SSH certificate (ca.winlab.tw) instead of
// a key on every machine. The steps follow the order they are done in.

const FINGERPRINT =
  "3caa3c7b7198b8c235398b62302e65a695eddc9a7c830bc9b040c7f257767870"

const steps: { title: string; text: string; command?: string }[] = [
  {
    title: "設定這台電腦",
    text: "macOS、Linux 執行 1 次。",
    command: "curl -fsSL https://portal.winlab.tw/ssh-ca/setup.sh | sh",
  },
  {
    title: "照常 ssh",
    text: "第一次會開瀏覽器用實驗室帳號登入，之後一天內不用再登入。",
  },
  {
    title: "Windows 或沒有瀏覽器",
    text: "裝好 step 後先信任實驗室 CA，每天手動領 1 次。",
    command: `step ca bootstrap --ca-url https://ca.winlab.tw --fingerprint ${FINGERPRINT}\nstep ssh login --provisioner winlab`,
  },
]

const machines = [
  "自己在 Carrel 開的機器",
  "所在專案在 Carrel 開的機器",
  "擁有者在 Carrel 加入你的機器",
]

export default async function KeyCertificatesPage() {
  await requireActor("/keys/certificates")
  return (
    <PortalShell page={keysPage} nav={keysNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="憑證" />
        <ol className="flex flex-col">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 border-b border-border py-4"
            >
              <span>
                {i + 1}. {step.title}
              </span>
              <span className="text-muted-foreground">{step.text}</span>
              {step.command && (
                <div className="flex items-start gap-4">
                  <pre className="min-w-0 flex-1 font-mono break-all whitespace-pre-wrap">
                    {step.command}
                  </pre>
                  <CopyKey label={step.title} line={step.command} what="指令" />
                </div>
              )}
            </li>
          ))}
        </ol>
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground">能登入的機器</h2>
          <ul className="flex flex-col">
            {machines.map((machine) => (
              <li
                key={machine}
                className="flex min-h-14 items-center border-b border-border py-3"
              >
                {machine}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PortalShell>
  )
}
