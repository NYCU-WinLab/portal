/** "NT$ 1,234" */
export function ntd(amount: number) {
  return `NT$ ${amount.toLocaleString("en-US")}`
}
