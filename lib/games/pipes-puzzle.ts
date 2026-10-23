// Pipes puzzle generator with deterministic seeding.
//
// Each level (1..LEVEL_COUNT) maps to a unique seed via mulberry32 PRNG, so
// every player gets the same 6×6 grid for the same level number. The grid is
// always a spanning tree rooted at the center (source), which guarantees the
// puzzle is solvable，every cell can be rotated back to its solved mask.
// Shuffling (see `shuffleInPlace`) only ever calls the passed-in `rng`, so the
// sequence of draws，and therefore the puzzle，is identical across JS
// engines and Bun builds, not just across runs on one binary.

export const PIPES_GRID = 6
export const PIPES_LEVEL_COUNT = 100

export const TOP = 1
export const RIGHT = 2
export const BOTTOM = 4
export const LEFT = 8

export function rotateCW(mask: number, times = 1): number {
  let m = mask
  for (let i = 0; i < times; i++) m = ((m << 1) | (m >> 3)) & 0xf
  return m
}

function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fisher-Yates (back-to-front), using only the supplied `rng`. Unlike
// `Array.prototype.sort` with a `() => rng() - 0.5` comparator，which is
// non-transitive and whose result for a given input is left
// implementation-defined by the spec，this produces the same permutation
// for the same `rng` draws on every engine and build.
function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

function generateSolved(
  rows: number,
  cols: number,
  sr: number,
  sc: number,
  rng: () => number
): number[][] {
  const grid: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0)
  )
  const visited = new Set<string>()

  function dfs(r: number, c: number): void {
    visited.add(`${r},${c}`)
    const dirs = shuffleInPlace(
      [
        { dr: -1, dc: 0, from: TOP, to: BOTTOM },
        { dr: 0, dc: 1, from: RIGHT, to: LEFT },
        { dr: 1, dc: 0, from: BOTTOM, to: TOP },
        { dr: 0, dc: -1, from: LEFT, to: RIGHT },
      ],
      rng
    )

    for (const { dr, dc, from, to } of dirs) {
      const nr = r + dr
      const nc = c + dc
      if (
        nr >= 0 &&
        nr < rows &&
        nc >= 0 &&
        nc < cols &&
        !visited.has(`${nr},${nc}`)
      ) {
        grid[r]![c]! |= from
        grid[nr]![nc]! |= to
        dfs(nr, nc)
      }
    }
  }

  dfs(sr, sc)
  return grid
}

export interface PipesPuzzle {
  level: number
  size: number
  source: [number, number]
  solved: number[][]
  scrambled: number[][]
}

export function getPuzzle(level: number): PipesPuzzle {
  const clamped = Math.max(1, Math.min(PIPES_LEVEL_COUNT, level | 0))
  // seed 0 produces a known-degenerate DFS path on some implementations; shift
  // so level=1 lands on seed=1.
  const rng = mulberry32(clamped)
  const center = Math.floor(PIPES_GRID / 2)
  const source: [number, number] = [center, center]
  const solved = generateSolved(PIPES_GRID, PIPES_GRID, center, center, rng)
  // The source cell is rendered with a disabled button (the player can't
  // rotate it), so its scrambled mask MUST match the solved orientation ，
  // otherwise the puzzle is unsolvable.
  const scrambled = solved.map((row, r) =>
    row.map((mask, c) => {
      if (r === source[0] && c === source[1]) return mask
      return mask ? rotateCW(mask, Math.floor(rng() * 4)) : 0
    })
  )
  return { level: clamped, size: PIPES_GRID, source, solved, scrambled }
}

export function getConnected(
  masks: number[][],
  source: [number, number],
  rows: number,
  cols: number
): Set<string> {
  const [sr, sc] = source
  const visited = new Set<string>([`${sr},${sc}`])
  const q: [number, number][] = [[sr, sc]]

  while (q.length) {
    const [r, c] = q.shift()!
    const m = masks[r]?.[c] ?? 0
    const neighbors: [number, number, number, number][] = [
      [-1, 0, TOP, BOTTOM],
      [0, 1, RIGHT, LEFT],
      [1, 0, BOTTOM, TOP],
      [0, -1, LEFT, RIGHT],
    ]
    for (const [dr, dc, cm, nm] of neighbors) {
      const nr = r + dr
      const nc = c + dc
      if (
        nr >= 0 &&
        nr < rows &&
        nc >= 0 &&
        nc < cols &&
        m & cm &&
        (masks[nr]?.[nc] ?? 0) & nm
      ) {
        const key = `${nr},${nc}`
        if (!visited.has(key)) {
          visited.add(key)
          q.push([nr, nc])
        }
      }
    }
  }
  return visited
}

export function getEndpoints(
  solved: number[][],
  source: [number, number]
): [number, number][] {
  const eps: [number, number][] = []
  solved.forEach((row, r) =>
    row.forEach((mask, c) => {
      if (r === source[0] && c === source[1]) return
      const count = [TOP, RIGHT, BOTTOM, LEFT].filter((b) => mask & b).length
      if (count === 1) eps.push([r, c])
    })
  )
  return eps
}
