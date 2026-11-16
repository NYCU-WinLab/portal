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

/** One named value of a key: the name muted, the value beside it. */
function KeyField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-6">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}

export default async function KeysPage() {
  const actor = await requireActor("/keys")
  const { name, keys, services } = await runAction(listMySshKeys, actor, {})

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
                <div className="flex min-w-0 flex-1 basis-64 flex-col">
                  <span className="truncate">
                    {[name, key.machine].filter(Boolean).join(" 的 ")}
                  </span>
                  {key.description && (
                    <span className="text-muted-foreground">
                      {key.description}
                    </span>
                  )}
                  <dl className="mt-3 flex flex-col gap-1">
                    <KeyField label="名稱">{key.label}</KeyField>
                    <KeyField label="指紋">
                      <span className="font-mono">
                        {key.type} {key.fingerprint}
                      </span>
                    </KeyField>
                    {key.source in keyHosts && (
                      <KeyField label="來源">
                        {keyHosts[key.source as KeyHost].label}
                      </KeyField>
                    )}
                    <KeyField label="建立">{day(key.createdAt)}</KeyField>
                  </dl>
                </div>
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
