import { z } from "zod"

export const IP_USER_CATEGORIES = {
  personal: "個人 PC",
  shared: "公用裝置",
  uncertain: "不確定",
  experiment: "實驗用",
  empty: "空",
  abnormal: "異常",
  unclassified: "未分類",
} as const

export type IpUserCategory = keyof typeof IP_USER_CATEGORIES

const ipv4 = z
  .string()
  .trim()
  .refine((value) => {
    const octets = value.split(".")
    return (
      octets.length === 4 &&
      octets.every(
        (octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255
      )
    )
  }, "請輸入完整 IPv4 位址")

export const ipUserInput = z
  .object({
    id: z.uuid().nullable(),
    ip: ipv4,
    user_name: z.string().trim().max(200, "使用者名稱最多 200 字"),
    category: z.enum([
      "personal",
      "shared",
      "uncertain",
      "experiment",
      "empty",
      "abnormal",
      "unclassified",
    ]),
    notes: z.string().trim().max(2000, "備註最多 2000 字"),
    expected_revision: z.number().int().positive().nullable(),
  })
  .refine(
    (value) => (value.id === null) === (value.expected_revision === null),
    "資料版本不正確，請重新整理"
  )

export const deleteIpUserInput = z.object({
  id: z.uuid(),
  expected_revision: z.number().int().positive(),
})

export type IpUserInput = z.infer<typeof ipUserInput>

export type IpUserEntry = {
  id: string
  ip: string
  user_name: string
  category: IpUserCategory
  notes: string
  revision: number
  updated_at: string
}

export type IpUserSettings = {
  subnet: string
  gateway: string
  dns_servers: string[]
  source_updated_on: string | null
}

export function ipUserError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "僅限 Portal 總管使用"
  if (
    error.code === "23505" ||
    (error.code === "22023" && error.message === "IP address already exists")
  )
    return "這個 IP 已有紀錄"
  if (error.code === "P0001") return "資料已被修改或刪除，請重新整理後再試"
  if (error.code === "22023" || error.code === "23514")
    return "請確認 IP 在此網段內，且不是保留位址"
  return "操作失敗，請稍後再試"
}

export function networkInfo(subnet: string) {
  const [address = "", prefix = "32"] = subnet.split("/")
  const value =
    address.split(".").reduce((n, octet) => (n << 8) | Number(octet), 0) >>> 0
  const mask =
    Number(prefix) === 0 ? 0 : (0xffffffff << (32 - Number(prefix))) >>> 0
  const dotted = (n: number) =>
    [24, 16, 8, 0].map((bits) => (n >>> bits) & 255).join(".")
  return {
    network: dotted(value & mask),
    broadcast: dotted(value | ~mask),
    netmask: dotted(mask),
  }
}
