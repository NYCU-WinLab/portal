import { describe, expect, test } from "bun:test"

import { actions, appOfAction } from "@/lib/actions/registry"
import { serviceApps } from "@/lib/api-apps"

// A service key belongs to no member: it runs actions with its own id as
// userId. Every action it can reach must work without a person behind it.
// These lists are pinned so that adding an app to serviceApps, or an action
// to one of those apps, fails here until someone checks the new action and
// updates the list.
describe("service keys", () => {
  test("reach only the apps checked for them", () => {
    expect([...serviceApps]).toEqual(["invitations", "avatars", "applications"])
  })

  test("reach only the actions checked for them", () => {
    const reachable = actions
      .filter((action) =>
        (serviceApps as readonly string[]).includes(
          appOfAction.get(action.name) ?? ""
        )
      )
      .filter((action) => !action.mcpExcludedBecause)
      .map((action) => action.name)
      .sort()
    expect(reachable).toEqual(
      [
        "confirm_lab_application",
        "get_lab_application_for_confirm",
        "get_lab_application_for_edit",
        "get_lab_application_status",
        "get_member_avatar",
        "resubmit_lab_application",
        "send_invitation",
        "send_lab_application_link",
        "send_lab_application_password_mail",
        "submit_lab_application",
        "withdraw_lab_application",
      ].sort()
    )
  })
})
