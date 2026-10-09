// Lab rules for lunch, shared by the pages and the actions.

/** A member's lunch stays at or under this, NT$; over it, their row turns red. */
export const BENTO_BUDGET = 140

/** 曾建超老師: exempt from the budget, and not someone to copy from. */
export const PROFESSOR_ID = "7b14c1a8-f142-4681-a738-b723f88803a0"

export function overBudget(userId: string, total: number) {
  return total > BENTO_BUDGET && userId !== PROFESSOR_ID
}

/** "NT$ 1,234" */
export function ntd(amount: number) {
  return `NT$ ${amount.toLocaleString("en-US")}`
}

/** "雞腿飯（半糖、少冰）" */
export function dishLabel(line: {
  name: string
  options: { label: string }[]
}) {
  return line.options.length
    ? `${line.name}（${line.options.map((option) => option.label).join("、")}）`
    : line.name
}
