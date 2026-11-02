// Gomoku on a 15 x 15 board: the member plays black and moves first, the
// computer plays white. Cells are row * SIZE + col; 0 is empty, 1 black,
// 2 white.

export const SIZE = 15
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export type Stone = typeof EMPTY | typeof BLACK | typeof WHITE

// Black moves at most this many times on a full board; the score of a win
// is MAX_BLACK_MOVES minus the moves it took, so fewer moves rank higher.
export const MAX_BLACK_MOVES = Math.ceil((SIZE * SIZE) / 2)

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const

function at(board: Stone[], r: number, c: number): Stone | -1 {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1
  return board[r * SIZE + c]!
}

/** The five or more cells in a row through `cell`, or null. */
export function winningLine(board: Stone[], cell: number): number[] | null {
  const color = board[cell]
  if (!color) return null
  const r = Math.floor(cell / SIZE)
  const c = cell % SIZE
  for (const [dr, dc] of DIRECTIONS) {
    const line = [cell]
    for (const sign of [1, -1]) {
      let k = 1
      while (at(board, r + sign * dr * k, c + sign * dc * k) === color) {
        line.push((r + sign * dr * k) * SIZE + c + sign * dc * k)
        k++
      }
    }
    if (line.length >= 5) return line
  }
  return null
}

// How good a run of `count` stones with `open` free ends is.
function runValue(count: number, open: number): number {
  if (count >= 5) return 1_000_000
  if (open === 0) return 0
  if (count === 4) return open === 2 ? 100_000 : 12_000
  if (count === 3) return open === 2 ? 8_000 : 600
  if (count === 2) return open === 2 ? 400 : 60
  return open === 2 ? 10 : 2
}

// The value of placing `color` at the empty `cell`.
function cellValue(board: Stone[], cell: number, color: Stone): number {
  const r = Math.floor(cell / SIZE)
  const c = cell % SIZE
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1]) {
      let k = 1
      while (at(board, r + sign * dr * k, c + sign * dc * k) === color) {
        count++
        k++
      }
      if (at(board, r + sign * dr * k, c + sign * dc * k) === EMPTY) open++
    }
    total += runValue(count, open)
  }
  return total
}

function nearStone(board: Stone[], cell: number): boolean {
  const r = Math.floor(cell / SIZE)
  const c = cell % SIZE
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      const v = at(board, r + dr, c + dc)
      if (v === BLACK || v === WHITE) return true
    }
  return false
}

/** The computer's move for white: its best attack or the block it needs. */
export function computerMove(board: Stone[]): number {
  const center = Math.floor((SIZE * SIZE) / 2)
  if (board[center] === EMPTY && board.every((v) => v === EMPTY)) return center
  let best = -1
  let bestValue = -1
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== EMPTY || !nearStone(board, cell)) continue
    // Attack weighs a little more, so a win beats blocking a win.
    const value =
      cellValue(board, cell, WHITE) * 1.1 +
      cellValue(board, cell, BLACK) +
      Math.random()
    if (value > bestValue) {
      bestValue = value
      best = cell
    }
  }
  return best === -1 ? board.indexOf(EMPTY) : best
}
