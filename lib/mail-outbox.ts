// What the outbox keeps of a mail once it is out of the sender's hands.
// A mail queued with redact_after_send carries a secret in its body (a link
// token); sending it, or giving up on it, blanks the body so the secret does
// not stay in mail_outbox.

/** The columns to set in the update that marks a mail sent or given up. */
export function outboxBodyAfterSend(redact: boolean) {
  return redact ? { text: "", html: null } : {}
}
