"use client"

import { FieldList, FieldRow } from "@/components/field-list"
import { SignaturePad, SignaturePreview } from "@/components/signature-pad"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import { saveSignature, saveSignatureSettings } from "./actions"

const corners = [
  { value: "br", label: "右下" },
  { value: "bl", label: "左下" },
  { value: "tr", label: "右上" },
  { value: "tl", label: "左上" },
]

// The member's handwritten signature and where it goes on what they upload.
export function SignatureSettings({
  image,
  stamp,
  corner,
}: {
  image: string | null
  stamp: boolean
  corner: string
}) {
  return (
    <div className="flex flex-col gap-6">
      {image && <SignaturePreview src={image} className="w-64" />}
      <SignaturePad
        trigger={
          <Button variant="outline" className="self-start">
            {image ? "重新簽名" : "簽名"}
          </Button>
        }
        onSave={(dataUrl) => report(saveSignature(dataUrl), "已儲存簽名")}
      />
      <FieldList>
        <FieldRow label="蓋在上傳的檔案">
          <Switch
            checked={stamp}
            disabled={!image}
            aria-label="蓋在上傳的檔案"
            onCheckedChange={(checked) =>
              report(
                saveSignatureSettings({ stamp: checked }),
                checked ? "會蓋上簽名" : "不蓋簽名"
              ).catch(() => {})
            }
          />
        </FieldRow>
        <FieldRow label="位置">
          <Select
            value={corner}
            items={corners}
            onValueChange={(value) =>
              report(saveSignatureSettings({ corner: value }), "已儲存").catch(
                () => {}
              )
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {corners.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </FieldList>
    </div>
  )
}
