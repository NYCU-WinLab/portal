import { KeycloakAdmin } from "@/lib/keycloak"
import { FakeKeycloak } from "../testing/fake-keycloak"
import { fakeKeycloakFetch } from "../testing/keycloak-http"
import { keycloakContract } from "./keycloak"

keycloakContract(async () => {
  const state = new FakeKeycloak()
  state.addGroup("/provisioning")
  const config = {
    issuer: "https://sso.example.test/realms/lab",
    clientSecret: "s",
    fetch: fakeKeycloakFetch(state),
    span: (async (_n: string, _a: unknown, fn: () => Promise<unknown>) =>
      fn()) as never,
  }
  // The portal client reads (and is the directory); the provisioner writes
  // and reads through it, as keycloakProvisioner() wires them.
  const reader = new KeycloakAdmin({ ...config, clientId: "portal" })
  const provisioner = new KeycloakAdmin({
    ...config,
    clientId: "portal-provisioner",
    reader,
  })
  return {
    directory: reader,
    provisioner,
    addGroup: async (path) => state.addGroup(path),
    deleteUser: async (id) => state.deleteUser(id),
    moveOutsideBoundary: async (id) => state.moveOutsideBoundary(id),
    withholdGroupPermission: async (path) =>
      state.withholdGroupPermission(path),
  }
})
