import { ADMIN } from "../testing/fixtures"
import { InMemoryApplicationStore } from "../testing/memory-store"
import { applicationStoreContract } from "./store"

applicationStoreContract(async ({ rate }) => {
  const s = await InMemoryApplicationStore.create({ rate })
  return {
    store: s,
    adminId: ADMIN.id,
    queuedMails: async () =>
      s.outbox().map((m) => ({
        applicationId: m.applicationId,
        kind: m.mail.kind,
        to: m.mail.to,
      })),
    changeRequestNotes: async (id) => s.changeRequestNotes(id),
    forgetAdmin: async (id) => s.forgetAdmin(id),
  }
})
