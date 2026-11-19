/** A request an action refuses on purpose: wrong input, someone else's
 * record, a rule not met. The member sees the message; the action's span
 * records refused=true instead of an error, so it raises no alert. Throw a
 * plain Error for a broken service or a bug. */
export class Refusal extends Error {}
