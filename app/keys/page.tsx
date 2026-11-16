import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listMySshKeys } from "@/lib/actions/keys"
import { requireActor } from "@/lib/auth/session"
import { type KeyHost, keyHostIds, keyHosts } from "@/lib/ssh-keys"

import {
  AddKey,
  DeleteKey,
  EditKey,
  ImportKeys,
  KeyServices,
} from "./key-forms"
import { day, keysNav, keysPage } from "./nav"

export const dynamic = "force-dynamic"

const hosts = keyHostIds.map((id) => ({ value: id, label: keyHosts[id].label }))

export default async function KeysPage() {
  const actor = await requireActor("/keys")
  const { username, keys, services } = await runAction(listMySshKeys, actor, {})

  return (
    <PortalShell page={keysPage} nav={keysNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="SSH 金鑰"
          actions={
            <>
              <ImportKeys hosts={hosts} />
              <AddKey />
            </>
          }
        />
        <Focus>
          <FocusLabel>我的金鑰</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{keys.length}</FocusHighlight> 把
          </FocusTitle>
        </Focus>
        {keys.length === 0 ? (
          <EmptyState noun="金鑰" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex min-h-14 flex-wrap items-center gap-4 border-b border-border py-3"
              >
                <span className="flex min-w-0 flex-1 basis-64 flex-col">
                  <span className="truncate">{key.label}</span>
                  <span className="truncate font-mono text-muted-foreground">
                    {[username, key.machine].filter(Boolean).join("@")}
                  </span>
                  {key.description && (
                    <span className="text-muted-foreground">
                      {key.description}
                    </span>
                  )}
                  <span className="truncate font-mono text-muted-foreground">
                    {key.type} {key.fingerprint}
                  </span>
                  <span className="text-muted-foreground">
                    {[
                      key.source in keyHosts &&
                        `${keyHosts[key.source as KeyHost].label} 匯入`,
                      `建立 ${day(key.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join("，")}
                  </span>
                </span>
                <KeyServices
                  id={key.id}
                  services={services}
                  used={key.services}
                />
                <EditKey
                  id={key.id}
                  value={{
                    label: key.label,
                    machine: key.machine ?? "",
                    description: key.description ?? "",
                  }}
                />
                <DeleteKey id={key.id} label={key.label} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
