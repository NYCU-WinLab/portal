/** The lab CA's user key (ca.winlab.tw/ssh/roots, userKey). */
export const LAB_USER_CA =
  "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEypPi2eUS00sJeJA9ebfrquCmA8reWrgdWSL4yGkfm4bKEuRyPmVJoM72JdUwzhH/v3VWkAkfPQ6sxMtzgruck="

/** OpenSSH 9.1p1 (the B09 jump host, Alpine 3.17) reads at most 40 names of
 * a principals="" option (MAX_PROP in match.c) and silently ignores the
 * rest, so a longer list refuses every member after the 40th. Debian's 9.2
 * reads them all; 40 per line works on both. */
export const PRINCIPALS_PER_LINE = 40

/** The authorized_keys lines that admit a lab certificate of a member the
 * service lets in now: a certificate names its member's username, and the
 * lines list exactly the members allowed at this read, so a member taken
 * out is refused at the next login like a removed key. A shared account
 * (B09's p4user) then takes certificates with no change on the machine.
 * One line per 40 members; sshd tries each line in turn. */
export function certificateLines(members: string[]): string[] {
  const lines: string[] = []
  for (let i = 0; i < members.length; i += PRINCIPALS_PER_LINE) {
    const names = members.slice(i, i + PRINCIPALS_PER_LINE).join(",")
    lines.push(`cert-authority,principals="${names}" ${LAB_USER_CA} lab-ssh-ca`)
  }
  return lines
}
