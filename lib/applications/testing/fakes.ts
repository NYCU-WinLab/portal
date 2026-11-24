import type { Email } from "../domain/values"
import type {
  ChangeNotifier,
  MailGroups,
  ProcessorAuthority,
  ReservedNames,
  Tracer,
} from "../ports"

export class FixedReservedNames implements ReservedNames {
  private readonly names: Set<string>
  constructor(names: readonly string[]) {
    this.names = new Set(names)
  }
  async has(name: string): Promise<boolean> {
    return this.names.has(name)
  }
}

type GroupInit = { address: string; manageable?: boolean; protected?: boolean }

export class FakeMailGroups implements MailGroups {
  private readonly joined = new Map<string, Set<string>>()
  private readonly failing = new Set<string>()
  constructor(private readonly groups: Record<string, GroupInit>) {}

  members(groupId: string): string[] {
    return [...(this.joined.get(groupId) ?? [])]
  }
  failNext(groupId: string): void {
    this.failing.add(groupId)
  }
  async add(
    groupId: string,
    email: Email,
    as: { actorId: string | null; isManager(groupId: string): Promise<boolean> }
  ) {
    if (this.failing.delete(groupId)) return "error" as const
    const group = this.groups[groupId]
    if (!group) return "error" as const
    if (group.protected) return "protected" as const
    const members = this.joined.get(groupId) ?? new Set<string>()
    if (members.has(email.value)) return "already" as const
    if (!(await as.isManager(groupId))) return "denied" as const
    members.add(email.value)
    this.joined.set(groupId, members)
    return "ok" as const
  }
  async isManageable(groupId: string): Promise<boolean> {
    return this.groups[groupId]?.manageable ?? true
  }
  async addresses(groupIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const id of groupIds) {
      const g = this.groups[id]
      if (g) out.set(id, g.address)
    }
    return out
  }
}

export class FakeAuthority implements ProcessorAuthority {
  portalAdmins: string[]
  managers: Record<string, string[]>
  processors: string[]
  adminEmails: string[]
  notifiees: string[]
  constructor(
    init: {
      portalAdmins?: string[]
      managers?: Record<string, string[]>
      processorEmails?: string[]
      portalAdminEmails?: string[]
      notifieeEmails?: string[]
    } = {}
  ) {
    this.portalAdmins = init.portalAdmins ?? []
    this.managers = init.managers ?? {}
    this.processors = init.processorEmails ?? []
    this.adminEmails = init.portalAdminEmails ?? []
    this.notifiees = init.notifieeEmails ?? []
  }
  async isPortalAdmin(userId: string) {
    return this.portalAdmins.includes(userId)
  }
  async managesGroup(userId: string, groupId: string) {
    return (this.managers[groupId] ?? []).includes(userId)
  }
  async processorEmails() {
    return [...this.processors]
  }
  async portalAdminEmails() {
    return [...this.adminEmails]
  }
  async notifieeEmails() {
    return [...this.notifiees]
  }
}

export class RecordingNotifier implements ChangeNotifier {
  count = 0
  async changed(): Promise<void> {
    this.count += 1
  }
}

export class NoopTracer implements Tracer {
  span<T>(
    _name: string,
    _attrs: Record<string, string | number>,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn()
  }
}
