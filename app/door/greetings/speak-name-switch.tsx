"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import { setSpeakName } from "./actions"

// The same switch as on the profile: off, the door only plays the sound and
// none of the member's phrases is spoken or recorded.
export function SpeakNameSwitch({ speak }: { speak: boolean }) {
  return (
    <Label className="flex items-center gap-2">
      念我的名字
      <Switch
        checked={speak}
        onCheckedChange={(checked) =>
          report(
            setSpeakName(checked),
            checked ? "開門會先念 Hi 你的名字" : "開門只播音效"
          ).catch(() => {})
        }
      />
    </Label>
  )
}
