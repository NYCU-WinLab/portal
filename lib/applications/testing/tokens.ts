import { createHash } from "node:crypto"
import { TokenHash } from "../domain/values"
import type { TokenGenerator } from "../ports"

/** Tokens are 24 characters: `test` and a 20-digit counter. */
export class SequentialTokens implements TokenGenerator {
  private n = 0
  generate() {
    this.n += 1
    const token = `test${String(this.n).padStart(20, "0")}`
    return { token, hash: this.hash(token) }
  }
  hash(token: string): TokenHash {
    return TokenHash.parse(createHash("sha256").update(token).digest("hex"))
  }
}
