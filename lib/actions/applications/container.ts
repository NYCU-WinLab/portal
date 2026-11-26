import { DbProcessorAuthority } from "@/lib/actions/applications/authority"
import { DbReservedNames } from "@/lib/actions/applications/reserved-names"
import { mailRateKey } from "@/lib/actions/applications/mail-rate-key"
import {
  DrizzleApplicationStore,
  DrizzleSettingsStore,
} from "@/lib/actions/applications/store"
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
  type SettingsStore,
  type TokenGenerator,
} from "@/lib/applications/ports"
import { MailComposer } from "@/lib/applications/services/mail-composer"
import { ApplicantService } from "@/lib/applications/services/applicant-service"
import { SettingsService } from "@/lib/applications/services/settings-service"
import { CryptoTokens } from "@/lib/applications/tokens"
import { db } from "@/lib/db"
import { keycloakReader, systemAccountUsernames } from "@/lib/keycloak"

/** What the actions call. PR 3 adds the review service. */
export type Applications = {
  applicant: ApplicantService
  settings: SettingsService
}

export type Deps = {
  store: ApplicationStore
  directory: KeycloakDirectory
  authority: ProcessorAuthority
  settings: SettingsStore
  reserved: ReservedNames
  mail: MailComposer
  tokens: TokenGenerator
  retention: RetentionPolicy
  rate: MailRatePolicy
  clock: Clock
  newId: () => string
}

export function build(deps: Deps): Applications {
  return {
    applicant: new ApplicantService(deps),
    settings: new SettingsService(deps),
  }
}

/**
 * The real wiring. Nothing here fails for a missing setting: the mail rate
 * key is derived when a mail is reserved, the portal URL when a mail is
 * composed, and the apply site's address (a setting) when a mail with its
 * link is composed, so only the request that needs them fails.
 */
export function productionDeps(): Deps {
  const rate = new MailRatePolicy()
  return {
    store: new DrizzleApplicationStore(db, { rate, hashSecret: mailRateKey }),
    directory: keycloakReader(),
    authority: new DbProcessorAuthority(db),
    settings: new DrizzleSettingsStore(db),
    reserved: new DbReservedNames(db, systemAccountUsernames),
    mail: new MailComposer({
      get siteUrl() {
        const value = process.env.BETTER_AUTH_URL
        if (!value) throw new Error("BETTER_AUTH_URL is not set")
        return value.replace(/\/$/, "")
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
