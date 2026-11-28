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
  RetryPolicy,
} from "@/lib/applications/domain/policies"
import {
  systemClock,
  type ApplicationStore,
  type ChangeNotifier,
  type Clock,
  type KeycloakDirectory,
  type KeycloakProvisioner,
  type MailGroups,
  type ProcessorAuthority,
  type ReservedNames,
  type SettingsStore,
  type TokenGenerator,
} from "@/lib/applications/ports"
import { RetentionJob } from "@/lib/applications/provisioning/retention-job"
import {
  ActivateAndMailStep,
  CreateAccountStep,
  FinishStep,
  JoinMailGroupsStep,
} from "@/lib/applications/provisioning/steps"
import { ProvisioningWorker } from "@/lib/applications/provisioning/worker"
import { MailComposer } from "@/lib/applications/services/mail-composer"
import { ApplicantService } from "@/lib/applications/services/applicant-service"
import { ReviewService } from "@/lib/applications/services/review-service"
import { SettingsService } from "@/lib/applications/services/settings-service"
import { CryptoTokens } from "@/lib/applications/tokens"
import { GoogleMailGroups } from "@/lib/actions/applications/mail-groups"
import { announceChange, onChange } from "@/lib/actions/changes"
import { db } from "@/lib/db"
import {
  keycloakProvisioner,
  keycloakReader,
  systemAccountUsernames,
} from "@/lib/keycloak"
import { emitErrorLog, traced } from "@/lib/otel"

/** What the actions call. */
export type Applications = {
  applicant: ApplicantService
  settings: SettingsService
  review: ReviewService
}

export type Deps = {
  store: ApplicationStore
  directory: KeycloakDirectory
  /** Lazy: making it needs KEYCLOAK_PROVISIONER_*; only the worker asks. */
  provisioner: () => KeycloakProvisioner
  authority: ProcessorAuthority
  settings: SettingsStore
  mailGroups: MailGroups
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
    review: new ReviewService(deps),
  }
}

/** The Keycloak reader is made on the first call, since making it needs KEYCLOAK_ISSUER. */
function lazyDirectory(): KeycloakDirectory {
  return {
    emailExists: (email) => keycloakReader().emailExists(email),
    usernamesTaken: (names) => keycloakReader().usernamesTaken(names),
    groupExists: (path) => keycloakReader().groupExists(path),
    forgetCaches: () => keycloakReader().forgetCaches(),
  }
}

/**
 * The real wiring. Nothing here fails for a missing setting: the mail rate
 * key is derived when a mail is reserved, the portal URL when a mail is
 * composed, the apply site's address (a setting) when a mail with its link
 * is composed, the Keycloak reader when it is first asked, and the Google
 * Groups client when a group is first looked at, so only the request that
 * needs them fails.
 */
export function productionDeps(): Deps {
  const rate = new MailRatePolicy()
  return {
    store: new DrizzleApplicationStore(db, { rate, hashSecret: mailRateKey }),
    directory: lazyDirectory(),
    provisioner: keycloakProvisioner,
    authority: new DbProcessorAuthority(db),
    settings: new DrizzleSettingsStore(db),
    mailGroups: new GoogleMailGroups(),
    reserved: new DbReservedNames(db, systemAccountUsernames),
    mail: new MailComposer({
      get siteUrl() {
        const value = process.env.BETTER_AUTH_URL
        if (!value) throw new Error("BETTER_AUTH_URL is not set")
        return value.replace(/\/$/, "")
      },
      get resetPasswordUrl() {
        return `${process.env.KEYCLOAK_ISSUER}/login-actions/reset-credentials?client_id=${process.env.KEYCLOAK_CLIENT_ID}`
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

function notifier(name: string): ChangeNotifier {
  return { changed: () => announceChange(name) }
}

/**
 * Runs the provisioning steps in this server process. Production leaves the
 * Keycloak provisioner credentials unset until it is switched on, so without
 * them nothing starts; that is normal, not an error.
 */
export function startApplicationProvisioner(): void {
  if (
    !process.env.KEYCLOAK_PROVISIONER_CLIENT_ID ||
    !process.env.KEYCLOAK_PROVISIONER_CLIENT_SECRET
  ) {
    console.info(
      "account provisioning is off: KEYCLOAK_PROVISIONER_CLIENT_ID/_SECRET are not set"
    )
    return
  }
  const d = productionDeps()
  const keycloak = d.provisioner()
  const worker = new ProvisioningWorker({
    store: d.store,
    clock: d.clock,
    // In STEP_NAMES order.
    steps: [
      new CreateAccountStep(keycloak),
      new JoinMailGroupsStep(d.mailGroups, d.authority, d.settings),
      new ActivateAndMailStep(keycloak, d.retention),
      new FinishStep(keycloak, d.directory, d.mail, d.authority),
    ],
    retry: new RetryPolicy(),
    tracer: { span: traced },
    notifier: notifier("lab_application_provisioning"),
    composer: d.mail,
    authority: d.authority,
  })
  // drain() guards itself against overlapping runs.
  const wake = () => void worker.drain().catch((e) => emitErrorLog(e, {}))
  onChange(wake).catch((e) => emitErrorLog(e, {}))
  setInterval(wake, 60_000).unref()
  wake()
}

/** The hourly housekeeping of applications, once at startup and then hourly. */
export function startApplicationRetention(): void {
  const d = productionDeps()
  const job = new RetentionJob({
    store: d.store,
    clock: d.clock,
    retention: d.retention,
    composer: d.mail,
    authority: d.authority,
    notifier: notifier("lab_application_retention"),
    tracer: { span: traced },
  })
  // tick() has no guard of its own, so a slow run never overlaps the next.
  let running = false
  const run = () => {
    if (running) return
    running = true
    void job
      .tick()
      .catch((e) => emitErrorLog(e, {}))
      .finally(() => {
        running = false
      })
  }
  setInterval(run, 60 * 60_000).unref()
  run()
}
