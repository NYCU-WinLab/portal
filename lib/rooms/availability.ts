// Which department rooms are free when, from the busy windows the department
// system reports. The lab cares whether the free tier (charge 0) has an
// opening, with paid rooms as a fallback, so a slot lists rooms per tier.

import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_MINUTES,
  clock,
  taipeiIso,
} from "@/lib/rooms/time"

export type Room = {
  name: string
  capacity: number
  /** NT$ per hour; 0 is the free tier. */
  charge: number
  active: boolean
}

/** One reservation in the department system, as ISO 8601 UTC instants. */
export type Busy = {
  room: string
  start: string
  end: string
  /** The account that booked it, e.g. the lab's own "cctseng". */
  subscriber: string
}

export type Slot = {
  start: string
  end: string
  freeRooms: string[]
  paidRooms: string[]
  /** Rooms held in this slot by the lab's own account. */
  labRooms: string[]
}

export type Tier = "lab" | "free" | "paid" | "full"

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart < bEnd && bStart < aEnd

/** The day's 30-minute grid, with the rooms open in each slot. */
export function daySlots(
  rooms: Room[],
  busy: Busy[],
  day: string,
  labAccount: string
): Slot[] {
  const active = rooms.filter((room) => room.active)
  const slots: Slot[] = []
  for (let m = DAY_START_HOUR * 60; m < DAY_END_HOUR * 60; m += SLOT_MINUTES) {
    const start = clock(m)
    const end = clock(m + SLOT_MINUTES)
    const from = taipeiIso(day, start)
    const to = taipeiIso(day, end)
    const taken = busy.filter((b) => overlaps(from, to, b.start, b.end))
    const open = (room: Room) => !taken.some((b) => b.room === room.name)
    slots.push({
      start,
      end,
      freeRooms: active
        .filter((r) => r.charge === 0 && open(r))
        .map((r) => r.name),
      paidRooms: active
        .filter((r) => r.charge > 0 && open(r))
        .map((r) => r.name),
      labRooms: [
        ...new Set(
          taken.filter((b) => b.subscriber === labAccount).map((b) => b.room)
        ),
      ],
    })
  }
  return slots
}

/** The lab already holding a room is the most useful thing to know. */
export function tierOf(slot: Slot): Tier {
  if (slot.labRooms.length) return "lab"
  if (slot.freeRooms.length) return "free"
  if (slot.paidRooms.length) return "paid"
  return "full"
}

// Floors in the order the lab prefers them; keyed on the floor digit so a
// new seminar room needs no list update.
const FLOOR_ORDER = [6, 5, 4, 3, 2, 1, 7]

function roomKey(name: string) {
  const match = /(\d+)([A-Za-z]*)\s*$/.exec(name.trim())
  if (!match) return { floor: FLOOR_ORDER.length, number: Infinity, suffix: "" }
  const floor = FLOOR_ORDER.indexOf(Number(match[1][0]))
  return {
    floor: floor === -1 ? FLOOR_ORDER.length : floor,
    number: Number(match[1]),
    suffix: match[2],
  }
}

/** Best room first: floor, then number, then 600B before 600A. */
export function compareRooms(a: string, b: string) {
  const left = roomKey(a)
  const right = roomKey(b)
  return (
    left.floor - right.floor ||
    left.number - right.number ||
    right.suffix.localeCompare(left.suffix)
  )
}

/**
 * The room /rooms would book for start..end: open for the whole span, free
 * tier before paid, then by floor. Null when no room is open throughout.
 */
export function pickRoom(
  slots: Slot[],
  start: string,
  end: string
): { room: string; paid: boolean } | null {
  const span = slots.filter((slot) => slot.start >= start && slot.end <= end)
  if (!span.length || span[0].start !== start || span.at(-1)!.end !== end)
    return null
  const throughout = (pick: (slot: Slot) => string[]) =>
    span
      .map(pick)
      .reduce((open, rooms) => open.filter((room) => rooms.includes(room)))
      .sort(compareRooms)[0]
  const free = throughout((slot) => slot.freeRooms)
  if (free) return { room: free, paid: false }
  const paid = throughout((slot) => slot.paidRooms)
  return paid ? { room: paid, paid: true } : null
}

/** The first reservation in room that overlaps start..end (ISO instants). */
export const findClash = (
  busy: Busy[],
  room: string,
  start: string,
  end: string
) =>
  busy
    .filter((b) => b.room === room && overlaps(start, end, b.start, b.end))
    .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null

export type Run = {
  start: string
  end: string
  tier: Tier
  freeRooms: string[]
  paidRooms: string[]
  labRooms: string[]
}

const sameRooms = (a: string[], b: string[]) =>
  a.length === b.length && a.every((room, i) => room === b[i])

/** Neighbouring slots with the same rooms, merged: what an agent reads. */
export function mergeRuns(slots: Slot[]): Run[] {
  const runs: Run[] = []
  for (const slot of slots) {
    const last = runs.at(-1)
    if (
      last &&
      last.end === slot.start &&
      sameRooms(last.freeRooms, slot.freeRooms) &&
      sameRooms(last.paidRooms, slot.paidRooms) &&
      sameRooms(last.labRooms, slot.labRooms)
    ) {
      last.end = slot.end
      continue
    }
    runs.push({ ...slot, tier: tierOf(slot) })
  }
  return runs
}
