import { FakeKeycloak } from "../testing/fake-keycloak"
import { keycloakContract } from "./keycloak"

keycloakContract(async () => {
  const kc = new FakeKeycloak()
  kc.addGroup("/provisioning")
  return {
    directory: kc,
    provisioner: kc,
    addGroup: async (path) => kc.addGroup(path),
    setPassword: async (id) => kc.setPassword(id),
    deleteUser: async (id) => kc.deleteUser(id),
  }
})
