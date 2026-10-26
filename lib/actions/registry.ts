import {
  grantAdmin,
  listAdmins,
  listMembers,
  revokeAdmin,
} from "@/lib/actions/admins"
import {
  addBentoOrderItem,
  closeBentoOrder,
  copyBentoOrder,
  createBentoOrder,
  deleteBentoOrder,
  getBentoOrder,
  getBentoStats,
  listBentoOrders,
  removeBentoOrderItem,
  reopenBentoOrder,
} from "@/lib/actions/bento"
import {
  createBentoRestaurant,
  deleteBentoRestaurant,
  getBentoMenuImage,
  getBentoRestaurant,
  listBentoRestaurants,
  setBentoMenu,
  setBentoMenuImage,
  setBentoOptionGroups,
  updateBentoRestaurant,
} from "@/lib/actions/bento-restaurants"
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "@/lib/actions/bulletin"
import {
  createApproveDocument,
  deleteApproveDocument,
  getApproveDocument,
  getApproveFile,
  listApproveDocuments,
  renameApproveDocument,
  setApproveFields,
  signApproveDocument,
  submitApproveDocument,
} from "@/lib/actions/approve"
import type { Action } from "@/lib/actions/define"
import type { ApiApp } from "@/lib/api-apps"
import { listHomePins, setHomePin } from "@/lib/actions/home"
import { getDoorStatus, listDoorEvents, openDoor } from "@/lib/actions/door"
import { listMyDoorCards, listMyDoorEvents } from "@/lib/actions/door-mine"
import {
  addDoorCard,
  compareDoorCards,
  deleteDoorCard,
  importDoorCards,
  listDoorCardChanges,
  listDoorCards,
  updateDoorCard,
} from "@/lib/actions/door-cards"
import {
  getMyDoorGreeting,
  setDoorSpeakName,
  setDoorSuffix,
} from "@/lib/actions/door-greetings"
import {
  createDoorPhrase,
  deleteDoorPhrase,
  deleteDoorVoiceClip,
  getDoorVoiceClip,
  listDoorPhrases,
  listDoorVoiceClips,
  updateDoorPhrase,
} from "@/lib/actions/door-phrases"
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/actions/api-keys"
import {
  deleteDoorSound,
  getDoorSound,
  listDoorSounds,
  renameDoorSound,
  replaceDoorSound,
  setDoorPlaylist,
  setDoorSoundDefault,
  uploadDoorSound,
} from "@/lib/actions/door-sounds"
import {
  addMailGroupMembers,
  getMailGroup,
  listCohorts,
  listMailGroupChanges,
  listMailGroupManagers,
  listMailGroups,
  listMyMailGroups,
  removeMailGroupMember,
  setMailGroupManager,
} from "@/lib/actions/groups"
import { listGameLeaderboard, recordGameScore } from "@/lib/actions/games"
import { deleteIpUser, listIpUsers, saveIpUser } from "@/lib/actions/ip-users"
import {
  authorizeDeveloperApp,
  getDeveloperApp,
  getDeveloperIntegration,
  listDeveloperApps,
  listDeveloperScopeRequests,
  listMyAuthorizations,
  registerDeveloperApp,
  requestDeveloperScopes,
  reviewDeveloperScopes,
  revokeMyAuthorization,
  rotateDeveloperSecret,
  setDeveloperAppEnabled,
  updateDeveloperApp,
} from "@/lib/actions/developers"
import { createLeave, deleteLeave, listLeaves } from "@/lib/actions/leave"
import {
  getNextLabMeeting,
  listLabMeetings,
  updateMyLabMeeting,
} from "@/lib/actions/meetings"
import {
  addLabMeeting,
  deleteLabMeeting,
  fillPresenters,
  generateSemester,
  setQuestioners,
  swapLabMeetings,
  updateLabMeeting,
} from "@/lib/actions/meetings-admin"
import {
  addPaper,
  addPaperTag,
  deletePaper,
  deletePaperTag,
  listPapers,
  listPaperTags,
  renamePaperTag,
  setShowPresentedPapers,
  updatePaper,
} from "@/lib/actions/papers"
import {
  addPresenter,
  listPresenters,
  movePresenter,
  removePresenter,
} from "@/lib/actions/presenters"
import { getProfile } from "@/lib/actions/profile"
import {
  deleteReceipt,
  getReceiptFile,
  listReceipts,
  updateReceipt,
  uploadReceipt,
} from "@/lib/actions/receipts"
import {
  getMemberAvatar,
  loadGravatars,
  loadMyGravatar,
  removeMemberAvatar,
  removeMyAvatar,
  setMyAvatar,
} from "@/lib/actions/avatars"
import {
  getMySignature,
  getMySignatureImage,
  setMySignature,
  setSignatureSettings,
} from "@/lib/actions/signature"
import {
  createTrip,
  deleteTrip,
  deleteTripFile,
  exportTripFiles,
  getTrip,
  getTripFile,
  getTripStats,
  listTrips,
  updateTrip,
  updateTripFile,
  uploadTripFile,
} from "@/lib/actions/trip"
import {
  addReimburseEgress,
  addReimburseIngress,
  deleteReimburseEgress,
  deleteReimburseIngress,
  getReimburseBalance,
  getReimburseStats,
  listReimburseEntries,
  updateReimburseEgress,
  updateReimburseIngress,
} from "@/lib/actions/reimburse"
import {
  bookMeeting,
  cancelMeeting,
  getEpicDeliverables,
  listGroupEpics,
  listRoomAvailability,
  listMeetings,
  listProjectGroups,
} from "@/lib/actions/rooms"
import {
  deleteStandingMeeting,
  listStandingMeetings,
  setStandingMeetingActive,
} from "@/lib/actions/rooms-series"
import {
  addPlaylist,
  addSong,
  listActivity,
  listPlayed,
  listQueue,
  nowPlaying,
  playNext,
  removeSong,
  searchMusic,
  setAutoplay,
  setPaused,
  setVolume,
  skipSong,
} from "@/lib/actions/music"
import { listAssets } from "@/lib/actions/assets"
import { listLabMembers } from "@/lib/actions/members"
import { listLabMeetingStats } from "@/lib/actions/stats"
import { whoami } from "@/lib/actions/users"

/** Every action, grouped by the app an API key must name to run it
 * (lib/api-apps.ts). app null: never through an API key, for actions
 * that manage access. MCP lists them in this order. */
export const actionGroups: { app: ApiApp | null; actions: Action[] }[] = [
  {
    app: "profile",
    actions: [
      whoami,
      getProfile,
      getMySignature,
      getMySignatureImage,
      setMySignature,
      setSignatureSettings,
      setMyAvatar,
      loadMyGravatar,
      loadGravatars,
      removeMyAvatar,
      removeMemberAvatar,
      getMemberAvatar,
      listHomePins,
      setHomePin,
    ],
  },
  {
    app: "members",
    actions: [listLabMembers],
  },
  {
    app: "leave",
    actions: [listLeaves, createLeave, deleteLeave],
  },
  {
    app: "bulletin",
    actions: [
      listAnnouncements,
      createAnnouncement,
      updateAnnouncement,
      deleteAnnouncement,
    ],
  },
  {
    app: "assets",
    actions: [listAssets],
  },
  {
    app: "receipts",
    actions: [
      listReceipts,
      getReceiptFile,
      uploadReceipt,
      updateReceipt,
      deleteReceipt,
    ],
  },
  {
    app: "door",
    actions: [
      getDoorStatus,
      openDoor,
      listDoorEvents,
      listMyDoorCards,
      listMyDoorEvents,
    ],
  },
  {
    app: "greetings",
    actions: [
      getMyDoorGreeting,
      setDoorSuffix,
      setDoorSpeakName,
      listDoorSounds,
      getDoorSound,
      uploadDoorSound,
      renameDoorSound,
      replaceDoorSound,
      deleteDoorSound,
      setDoorPlaylist,
      setDoorSoundDefault,
      listDoorPhrases,
      createDoorPhrase,
      updateDoorPhrase,
      deleteDoorPhrase,
      listDoorVoiceClips,
      getDoorVoiceClip,
      deleteDoorVoiceClip,
    ],
  },
  {
    app: "meetings",
    actions: [
      listLabMeetings,
      getNextLabMeeting,
      updateMyLabMeeting,
      listPapers,
      listPaperTags,
      setShowPresentedPapers,
      listPresenters,
      listLabMeetingStats,
      generateSemester,
      addLabMeeting,
      updateLabMeeting,
      deleteLabMeeting,
      swapLabMeetings,
      fillPresenters,
      setQuestioners,
      addPaper,
      updatePaper,
      deletePaper,
      addPaperTag,
      renamePaperTag,
      deletePaperTag,
      addPresenter,
      removePresenter,
      movePresenter,
      listRoomAvailability,
      listMeetings,
      listProjectGroups,
      listGroupEpics,
      getEpicDeliverables,
      bookMeeting,
      cancelMeeting,
      listStandingMeetings,
      setStandingMeetingActive,
      deleteStandingMeeting,
    ],
  },
  {
    app: "bento",
    actions: [
      listBentoOrders,
      getBentoOrder,
      listBentoRestaurants,
      getBentoRestaurant,
      getBentoMenuImage,
      getBentoStats,
      addBentoOrderItem,
      removeBentoOrderItem,
      copyBentoOrder,
      createBentoOrder,
      closeBentoOrder,
      reopenBentoOrder,
      deleteBentoOrder,
      createBentoRestaurant,
      updateBentoRestaurant,
      deleteBentoRestaurant,
      setBentoMenu,
      setBentoOptionGroups,
      setBentoMenuImage,
    ],
  },
  {
    app: "reimburse",
    actions: [
      listReimburseEntries,
      getReimburseBalance,
      getReimburseStats,
      addReimburseEgress,
      updateReimburseEgress,
      deleteReimburseEgress,
      addReimburseIngress,
      updateReimburseIngress,
      deleteReimburseIngress,
    ],
  },
  {
    app: "trip",
    actions: [
      listTrips,
      getTrip,
      getTripFile,
      exportTripFiles,
      getTripStats,
      uploadTripFile,
      updateTripFile,
      deleteTripFile,
      createTrip,
      updateTrip,
      deleteTrip,
    ],
  },
  {
    app: "approve",
    actions: [
      listApproveDocuments,
      getApproveDocument,
      getApproveFile,
      createApproveDocument,
      renameApproveDocument,
      setApproveFields,
      submitApproveDocument,
      signApproveDocument,
      deleteApproveDocument,
    ],
  },
  {
    app: "groups",
    actions: [
      listMailGroups,
      listMyMailGroups,
      getMailGroup,
      addMailGroupMembers,
      removeMailGroupMember,
      listMailGroupChanges,
      listMailGroupManagers,
      listCohorts,
    ],
  },
  {
    app: "games",
    actions: [listGameLeaderboard, recordGameScore],
  },
  {
    app: null,
    actions: [
      listDoorCards,
      addDoorCard,
      updateDoorCard,
      deleteDoorCard,
      compareDoorCards,
      importDoorCards,
      listDoorCardChanges,
      setMailGroupManager,
      listIpUsers,
      saveIpUser,
      deleteIpUser,
      listDeveloperApps,
      getDeveloperApp,
      getDeveloperIntegration,
      registerDeveloperApp,
      updateDeveloperApp,
      rotateDeveloperSecret,
      setDeveloperAppEnabled,
      requestDeveloperScopes,
      listDeveloperScopeRequests,
      reviewDeveloperScopes,
      listMyAuthorizations,
      revokeMyAuthorization,
      authorizeDeveloperApp,
      listMembers,
      listAdmins,
      grantAdmin,
      revokeAdmin,
      listApiKeys,
      createApiKey,
      revokeApiKey,
    ],
  },
  {
    app: "music",
    actions: [
      nowPlaying,
      listQueue,
      listActivity,
      listPlayed,
      searchMusic,
      addSong,
      addPlaylist,
      playNext,
      skipSong,
      removeSong,
      setPaused,
      setVolume,
      setAutoplay,
    ],
  },
]

export const actions: Action[] = actionGroups.flatMap((g) => g.actions)

/** The app an action belongs to, by action name. */
export const appOfAction = new Map(
  actionGroups.flatMap((g) => g.actions.map((a) => [a.name, g.app] as const))
)

/** Changes announced outside an action, by the app whose data they touch;
 * null keeps them off API keys. `bun run api:check` fails when an
 * announceChange name is missing here. The music player's reports arrive
 * as player_<event>. */
export const backgroundChanges: Record<string, ApiApp | null> = {
  "player_*": "music",
  autoplay: "music",
  card_swipe: "door",
  compare_door_cards: null,
  room_daily_run: "meetings",
  room_meeting_callback: "meetings",
  store_door_voice_clip: "greetings",
}

/** The app a change on /api/events belongs to, or null. */
export function appOfChange(name: string): ApiApp | null {
  if (name.startsWith("player_")) return backgroundChanges["player_*"] ?? null
  if (Object.hasOwn(backgroundChanges, name))
    return backgroundChanges[name] ?? null
  return appOfAction.get(name) ?? null
}
