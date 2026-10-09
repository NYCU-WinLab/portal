import {
  grantAdmin,
  listAdmins,
  listMembers,
  revokeAdmin,
} from "@/lib/actions/admins"
import type { Action } from "@/lib/actions/define"
import { createLeave, deleteLeave, listLeaves } from "@/lib/actions/leave"
import {
  claimMeeting,
  getNextMeeting,
  listMeetings,
  releaseMeeting,
  updateMyMeeting,
} from "@/lib/actions/meetings"
import {
  addMeeting,
  deleteMeeting,
  fillPresenters,
  generateSemester,
  setQuestioners,
  swapMeetings,
  updateMeeting,
} from "@/lib/actions/meetings-admin"
import {
  addPaper,
  deletePaper,
  listPapers,
  updatePaper,
} from "@/lib/actions/papers"
import {
  addPresenter,
  listPresenters,
  movePresenter,
  removePresenter,
} from "@/lib/actions/presenters"
import { getProfile } from "@/lib/actions/profile"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  getProfile,
  listLeaves,
  createLeave,
  deleteLeave,
  listMeetings,
  getNextMeeting,
  claimMeeting,
  releaseMeeting,
  updateMyMeeting,
  listPapers,
  listPresenters,
  generateSemester,
  addMeeting,
  updateMeeting,
  deleteMeeting,
  swapMeetings,
  fillPresenters,
  setQuestioners,
  addPaper,
  updatePaper,
  deletePaper,
  addPresenter,
  removePresenter,
  movePresenter,
  listMembers,
  listAdmins,
  grantAdmin,
  revokeAdmin,
]
