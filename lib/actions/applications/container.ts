import { DbProcessorAuthority } from "@/lib/actions/applications/authority"
import { DbReservedNames } from "@/lib/actions/applications/reserved-names"
import { DrizzleApplicationStore } from "@/lib/actions/applications/store"
import {
  MailRatePolicy,
  RetentionPolicy,
} from "@/lib/applications/domain/policies"
import {
  systemClock,
  type ApplicationStore,
  type Clock,
  type KeycloakDirectory,
  type ProcessorAuthority,
  type ReservedNames,
  type TokenGenerator,
} from "@/lib/applications/ports"
import { MailComposer } from "@/lib/applications/services/mail-composer"
import { ApplicantService } from "@/lib/applications/services/applicant-service"
import { CryptoTokens } from "@/lib/applications/tokens"
import { db } from "@/lib/db"
import { keycloakReader, systemAccountUsernames } from "@/lib/keycloak"

/** What the actions call. PR 3 adds the review and settings services. */
export type Applications = { applicant: ApplicantService }

export type Deps = {
  store: ApplicationStore
  directory: KeycloakDirectory
  authority: ProcessorAuthority
  reserved: ReservedNames
  mail: MailComposer
  tokens: TokenGenerator
  retention: RetentionPolicy
  rate: MailRatePolicy
  clock: Clock
  newId: () => string
}

export function build(deps: Deps): Applications {
  return { applicant: new ApplicantService(deps) }
}

/**
 * The real wiring. Nothing here fails for a missing setting: the hash secret
 * is read when a mail is reserved, and the site URLs when a mail is
 * composed, so only the request that needs them fails.
 */
export function productionDeps(): Deps {
  const rate = new MailRatePolicy()
  const url = (name: "APPLY_SITE_URL" | "BETTER_AUTH_URL") => () => {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value.replace(/\/$/, "")
  }
  return {
    store: new DrizzleApplicationStore(db, {
      rate,
      hashSecret: () => process.env.APPLICATION_HASH_SECRET ?? "",
    }),
    directory: keycloakReader(),
    authority: new DbProcessorAuthority(db),
    reserved: new DbReservedNames(db, systemAccountUsernames),
    mail: new MailComposer({
      get siteUrl() {
        return url("BETTER_AUTH_URL")()
      },
      get applySiteUrl() {
        return url("APPLY_SITE_URL")()
      },
    }),
    tokens: new CryptoTokens(),
    retention: new RetentionPolicy(),
    rate,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
  }
}

const shared = globalThis as unknown as {
  labApplications?: { built?: Applications }
}

/** Built on first use and kept across dev reloads. */
export const applications = (): Applications =>
  ((shared.labApplications ??= {}).built ??= build(productionDeps()))
