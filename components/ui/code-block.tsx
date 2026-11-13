"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// Text a member copies and runs or pastes: a command, a request, a config
// file. A 2.5rem bar names it and holds the copy button; the text below
// keeps its own line breaks and scrolls sideways, so a long line never
// breaks in the middle of a word. It shares its edge and corners with
// `terminal` and `browser`, and uses the page's colors in both themes.
function CodeBlock({
  title,
  code,
  className,
}: {
  /** What the text is or does: "換 token", ".env". */
  title?: React.ReactNode
  /** The text, exactly as it is copied. */
  code: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <figure
      data-slot="code-block"
      className={cn(
        "overflow-hidden rounded-menu border border-border text-body",
        className
      )}
    >
      <figcaption className="flex h-10 items-center gap-2 border-b border-border bg-muted pl-4 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? "已複製" : "複製"}
          onClick={() =>
            navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => {}
            )
          }
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3 font-mono leading-6">
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export { CodeBlock }
