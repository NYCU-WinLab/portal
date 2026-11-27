import { KeycloakAdmin } from "@/lib/keycloak"
import { FakeKeycloak } from "../testing/fake-keycloak"
import { fakeKeycloakFetch } from "../testing/keycloak-http"
import { keycloakContract } from "./keycloak"

keycloakContract(async () => {
  const state = new FakeKeycloak()
  state.addGroup("/provisioning")
  const admin = new KeycloakAdmin({
    issuer: "https://sso.example.test/realms/lab",
    clientId: "portal-provisioner",
    clientSecret: "s",
    fetch: fakeKeycloakFetch(state),
    span: (async (_n: string, _a: unknown, fn: () => Promise<unknown>) =>
      fn()) as never,
  })
  return {
    directory: admin,
    provisioner: admin,
    addGroup: async (path) => state.addGroup(path),
    deleteUser: async (id) => state.deleteUser(id),
  }
})
