"use client"

import * as React from "react"
import {
  FileAudioIcon,
  FileIcon,
  FileTextIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"

/** 240 KB, 3.2 MB. */
function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`
}

// The same rules as the input's accept attribute: ".pdf", "image/*",
// "application/pdf".
function matchesAccept(file: File, accept?: string) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  return accept.split(",").some((token) => {
    const rule = token.trim().toLowerCase()
    if (rule.startsWith(".")) return name.endsWith(rule)
    if (rule.endsWith("/*")) return file.type.startsWith(rule.slice(0, -1))
    return file.type === rule
  })
}

type Rejected = { file: File; reason: string }

type FileUploadProps = {
  value: File[]
  onValueChange: (files: File[]) => void
  /** As on an input: ".pdf,image/*". */
  accept?: string
  /** How accept reads to people: "PDF、JPG、PNG". */
  acceptLabel?: string
  /** Bytes per file. */
  maxSize?: number
  multiple?: boolean
  /** Also take files pasted anywhere on the page (⌘V) while it is shown. */
  paste?: boolean
  /** Posts the chosen files under this name, for FormDialog. */
  name?: string
  disabled?: boolean
  className?: string
  id?: string
}

// A drop area that also opens the file picker, then the chosen files as
// attachments to check and remove before sending. Files that do not fit
// accept or maxSize show as errors with the reason and are left out of value.
function FileUpload({
  value,
  onValueChange,
  accept,
  acceptLabel,
  maxSize,
  multiple = false,
  paste = false,
  name,
  disabled,
  className,
  id,
}: FileUploadProps) {
  const [dragging, setDragging] = React.useState(false)
  const [rejected, setRejected] = React.useState<Rejected[]>([])
  const formRef = React.useRef<HTMLInputElement>(null)

  const add = React.useCallback(
    (incoming: File[]) => {
      if (disabled || incoming.length === 0) return
      const accepted: File[] = []
      const refused: Rejected[] = []
      for (const file of multiple ? incoming : incoming.slice(0, 1)) {
        if (!matchesAccept(file, accept)) {
          refused.push({ file, reason: "不支援這種檔案" })
        } else if (maxSize && file.size > maxSize) {
          refused.push({ file, reason: `超過 ${formatBytes(maxSize)}` })
        } else {
          accepted.push(file)
        }
      }
      setRejected(refused)
      if (accepted.length > 0) {
        onValueChange(multiple ? [...value, ...accepted] : accepted)
      }
    },
    [accept, disabled, maxSize, multiple, onValueChange, value]
  )

  React.useEffect(() => {
    if (!paste) return
    function onPaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      add(files)
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [add, paste])

  // Mirror value into a named file input so a surrounding form posts it.
  React.useEffect(() => {
    if (!formRef.current) return
    const transfer = new DataTransfer()
    for (const file of value) transfer.items.add(file)
    formRef.current.files = transfer.files
  }, [value])

  const hint = [
    acceptLabel,
    maxSize ? `每個 ${formatBytes(maxSize)} 以內` : undefined,
  ]
    .filter(Boolean)
    .join("，")

  return (
    <div
      data-slot="file-upload"
      className={cn("flex flex-col gap-3", className)}
    >
      <label
        data-dragging={dragging || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          add(Array.from(event.dataTransfer.files))
        }}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-surface border border-dashed border-input p-6 text-center transition-colors duration-state hover:bg-muted/50 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 data-dragging:border-ring data-dragging:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4"
      >
        <UploadIcon className="text-muted-foreground" />
        <span className="font-medium">
          {paste ? "拖放、貼上檔案，或點這裡選擇" : "拖放檔案，或點這裡選擇"}
        </span>
        {hint && <span className="text-muted-foreground">{hint}</span>}
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      </label>
      {name && (
        <input
          ref={formRef}
          type="file"
          name={name}
          multiple
          hidden
          tabIndex={-1}
        />
      )}
      {(value.length > 0 || rejected.length > 0) && (
        <AttachmentGroup>
          {value.map((file, index) => (
            <Attachment key={`${file.name}-${file.lastModified}-${index}`}>
              <FileMedia file={file} />
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>
                  {formatBytes(file.size)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`移除 ${file.name}`}
                  disabled={disabled}
                  onClick={() =>
                    onValueChange(value.filter((_, i) => i !== index))
                  }
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
          {rejected.map(({ file, reason }, index) => (
            <Attachment key={`rejected-${file.name}-${index}`} state="error">
              <FileMedia file={file} />
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>{reason}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`移除 ${file.name}`}
                  onClick={() =>
                    setRejected(rejected.filter((_, i) => i !== index))
                  }
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
    </div>
  )
}

// A thumbnail for images, an icon by kind for the rest. The image's object
// URL lives exactly as long as the <img>.
function FileMedia({ file }: { file: File }) {
  return (
    <AttachmentMedia>
      {file.type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          ref={(img) => {
            if (!img) return
            const url = URL.createObjectURL(file)
            img.src = url
            return () => URL.revokeObjectURL(url)
          }}
        />
      ) : file.type.startsWith("audio/") ? (
        <FileAudioIcon />
      ) : file.type === "application/pdf" ? (
        <FileTextIcon />
      ) : (
        <FileIcon />
      )}
    </AttachmentMedia>
  )
}

export { FileUpload, formatBytes }
