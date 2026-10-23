import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { getApproveDocument } from "@/lib/actions/approve"
import { runAction } from "@/lib/actions/define"
import { getMySignatureImage } from "@/lib/actions/signature"
import { requireActor } from "@/lib/auth/session"

import { approvePage } from "../nav"
import { DocumentActions } from "./document-actions"
import { FieldEditor } from "./field-editor"
import { SignView } from "./sign-view"
import { DocView } from "./doc-view"

export const dynamic = "force-dynamic"

export default async function ApproveDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor(`/approve/${id}`)
  const doc = await runAction(getApproveDocument, actor, { id }).catch(
    () => null
  )
  if (!doc) notFound()
  const file = `/approve/${doc.id}/file`
  const editing = doc.mine && doc.status === "draft"
  const signing = doc.toFill.length > 0
  const [members, signature] = await Promise.all([
    editing ? runAction(listMembers, actor, {}) : [],
    signing ? runAction(getMySignatureImage, actor, {}) : { dataUrl: null },
  ])
  const signed = doc.signers.filter((s) => s.signedAt).length

  return (
    <PortalShell page={approvePage} layout="wide">
      <div className="flex flex-col gap-8">
        <PageHeader
          title={doc.title}
          actions={
            <DocumentActions
              id={doc.id}
              title={doc.title}
              mine={doc.mine}
              status={doc.status}
            />
          }
        />
        <p className="text-muted-foreground">
          {doc.creator} 建立
          {doc.status !== "draft" &&
            `，${signed}/${doc.signers.length} 人簽好：${doc.signers
              .map((s) => `${s.name}${s.signedAt ? "（已簽）" : ""}`)
              .join("、")}`}
        </p>
        {editing ? (
          <FieldEditor
            id={doc.id}
            file={file}
            fields={doc.fields}
            members={members}
          />
        ) : signing ? (
          <SignView
            id={doc.id}
            file={file}
            fields={doc.fields}
            toFill={doc.toFill}
            signature={signature.dataUrl}
          />
        ) : (
          <DocView title={doc.title} file={file} fields={doc.fields} />
        )}
      </div>
    </PortalShell>
  )
}
