"use client"

import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"
import {
  TYPING_LANGUAGES,
  countUnits,
  getTypingLanguage,
} from "@/lib/games/typing-passages"

type State = "idle" | "playing" | "done"

interface GameTypingProps {
  onComplete: (result: GameResult) => void
  onLevelChange?: (level: number | null, displayLabel?: string | null) => void
}

export function GameTyping({ onComplete, onLevelChange }: GameTypingProps) {
  const [languageId, setLanguageId] = useState(0)
  const [target, setTarget] = useState("")
  const [input, setInput] = useState("")
  const [state, setState] = useState<State>("idle")
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const language = getTypingLanguage(languageId)

  const pickPassage = useCallback((langId: number): string => {
    const lang = getTypingLanguage(langId)
    const pool = lang.passages
    return pool[Math.floor(Math.random() * pool.length)] ?? pool[0]!
  }, [])

  const start = useCallback(
    (langId: number = languageId) => {
      const lang = getTypingLanguage(langId)
      completedRef.current = false
      setLanguageId(langId)
      onLevelChange?.(langId, lang.label)
      setTarget(pickPassage(langId))
      setInput("")
      setState("playing")
      startRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    [languageId, onLevelChange, pickPassage]
  )

  const selectLanguage = useCallback(
    (langId: number) => {
      // Switching language from idle just updates the preview; from playing
      // restarts cleanly into the new language.
      if (state === "idle") {
        setLanguageId(langId)
        onLevelChange?.(langId, getTypingLanguage(langId).label)
      } else {
        start(langId)
      }
    },
    [state, onLevelChange, start]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (state !== "playing") return
      const val = e.target.value

      // Reject sudden large inserts (paste, IME drop)，> 4 chars added at once
      if (val.length - input.length > 4) return

      if (!startRef.current) startRef.current = Date.now()

      setInput(val)

      if (val === target && !completedRef.current) {
        completedRef.current = true
        const ms = Math.max(Date.now() - startRef.current, 1)
        const units = countUnits(target, language.code)
        const wpm = Math.round((units / ms) * 60000)
        setState("done")
        if (ms >= 1000 && wpm <= 300) {
          onComplete({ score: wpm * 10, finishTimeMs: ms })
        }
      }
    },
    [state, target, input, language.code, onComplete]
  )

  const correctCount = input
    .split("")
    .filter((ch, i) => ch === target[i]).length
  const accuracy =
    input.length > 0 ? Math.round((correctCount / input.length) * 100) : 100

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap justify-center gap-2">
        {TYPING_LANGUAGES.map((lang) => (
          <button
            key={lang.id}
            type="button"
            onClick={() => selectLanguage(lang.id)}
            disabled={state === "done"}
            aria-pressed={languageId === lang.id}
            className={`rounded-control border px-3 py-1 text-body font-medium transition-colors ${
              languageId === lang.id
                ? "border-foreground bg-foreground text-background"
                : "border-muted hover:border-foreground"
            } disabled:opacity-60`}
          >
            {lang.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-body text-muted-foreground">
          <span className="mr-3">{language.label}</span>準確率{" "}
          <span
            className={`font-medium ${accuracy < 80 ? "text-destructive" : "text-foreground"}`}
          >
            {accuracy}%
          </span>
        </div>
        <Button variant="outline" onClick={() => start(languageId)}>
          {state === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      {state === "idle" ? (
        <p className="py-8 text-center text-body text-muted-foreground">
          選擇語言後點擊「開始遊戲」，完整輸入下方段落
        </p>
      ) : (
        <>
          <div
            lang={language.code}
            className="rounded-control border bg-muted/30 p-4 font-mono text-body leading-relaxed select-none"
          >
            {target.split("").map((ch, i) => {
              let cls = "text-muted-foreground"
              if (i < input.length) {
                cls =
                  input[i] === ch
                    ? "text-success"
                    : "text-destructive bg-destructive/15"
              } else if (i === input.length) {
                cls = "border-b-2 border-primary text-foreground"
              }
              return (
                <span key={i} className={cls}>
                  {ch}
                </span>
              )
            })}
          </div>

          <input
            ref={inputRef}
            value={input}
            onChange={handleChange}
            onPaste={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            disabled={state === "done"}
            lang={language.code}
            className="w-full rounded-control border bg-background px-3 py-2 font-mono text-body ring-1 ring-muted outline-none focus:ring-primary"
            placeholder="在此輸入..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
          />
        </>
      )}

      {state === "done" && (
        <p className="text-center font-medium text-success">🎉 完成！</p>
      )}
    </div>
  )
}
