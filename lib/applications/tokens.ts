import { createHash, randomBytes } from "node:crypto"
import { TokenHash } from "./domain/values"
import type { TokenGenerator } from "./ports"

/** 32 random bytes as base64url (43 characters); only the sha256 is stored. */
export class CryptoTokens implements TokenGenerator {
  generate(): { token: string; hash: TokenHash } {
    const token = randomBytes(32).toString("base64url")
    return { token, hash: this.hash(token) }
  }

  hash(token: string): TokenHash {
    return TokenHash.parse(createHash("sha256").update(token).digest("hex"))
  }
}
