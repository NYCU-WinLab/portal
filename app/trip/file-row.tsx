"use client"

import { DownloadIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { report } from "@/lib/report"

import { describeFile, removeFile } from "./actions"

/** 240 KB, 3.2 MB. */
function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`
}

type File = {
  id: string
  filename: string
  description: string | null
  size: number
  signatureLevel: string | null
}

// One file: its name opens the PDF; download, describe and delete beside it.
export function FileRow({
  file,
  canEdit,
  canDelete,
}: {
  file: File
  canEdit: boolean
  canDelete: boolean
}) {
  return (
    <li className="flex min-h-14 items-center gap-4 border-b border-border py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <a
          href={`/trip/files/${file.id}`}
          target="_blank"
          rel="noreferrer"
          className="truncate underline-offset-4 hover:underline"
        >
          {file.filename}
        </a>
        <span className="truncate text-muted-foreground">
          {file.description ? `${file.description}，` : ""}
          {size(file.size)}
          {file.signatureLevel === "kept"
            ? "，原檔已有簽章"
            : file.signatureLevel && "，已簽章"}
        </span>
      </span>
      <div className="flex shrink-0 gap-1">
        <a
          href={`/trip/files/${file.id}?download`}
          aria-label={`下載 ${file.filename}`}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <DownloadIcon />
        </a>
        {canEdit && (
          <FormDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label="修改說明">
                <PencilIcon />
              </Button>
            }
            title="修改說明"
            submitLabel="儲存"
            onSubmit={(data) =>
              report(
                describeFile(file.id, String(data.get("description") ?? "")),
                "已儲存"
              )
            }
          >
            <FormField label="說明">
              <Input
                name="description"
                maxLength={200}
                defaultValue={file.description ?? ""}
              />
            </FormField>
          </FormDialog>
        )}
        {canDelete && (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label="刪除">
                <Trash2Icon />
              </Button>
            }
            title={`刪除 ${file.filename}？`}
            confirmLabel="刪除"
            onConfirm={() => report(removeFile(file.id), "已刪除")}
          />
        )}
      </div>
    </li>
  )
}
