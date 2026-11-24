import { InMemorySettingsStore } from "../testing/memory-store"
import { settingsStoreContract } from "./settings"

const USER = "00000000-0000-4000-8000-000000000011"
const OTHER = "00000000-0000-4000-8000-000000000012"

settingsStoreContract(async () => ({
  store: new InMemorySettingsStore({
    [USER]: { name: "王小明", email: "xmwang@winlab.tw" },
    [OTHER]: { name: "陳大文", email: "dwchen@winlab.tw" },
  }),
  userId: USER,
  otherUserId: OTHER,
}))
