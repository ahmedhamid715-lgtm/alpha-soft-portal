import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  LifeBuoy,
  Settings,
  FileText,
  CreditCard,
  BarChart3,
  Bot,
  ListChecks,
  Search as SearchIcon,
  Handshake,
  Megaphone,
  ClipboardList,
  Ticket,
  User,
  UserCog,
  Bell,
  Monitor,
  ShieldCheck,
  KeyRound,
  Tags,
  type LucideIcon,
} from "lucide-react"

/**
 * `NavItem.icon` (config/navigation.ts) is a string, not a component
 * reference — nav config stays serializable data, not JSX. This map is
 * the one place a string name resolves to an actual icon. Add to it as
 * new modules introduce new nav items; never import a Lucide icon
 * directly in a nav-config object.
 */
export const NAV_ICON_MAP: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  organizations: Building2,
  projects: Briefcase,
  support: LifeBuoy,
  settings: Settings,
  documents: FileText,
  billing: CreditCard,
  analytics: BarChart3,
  ai: Bot,
  tasks: ListChecks,
  search: SearchIcon,
  crm: Handshake,
  marketing: Megaphone,
  reports: ClipboardList,
  tickets: Ticket,
  profile: User,
  account: UserCog,
  notifications: Bell,
  sessions: Monitor,
  audit: ShieldCheck,
  roles: KeyRound,
  plans: Tags,
}

export function resolveNavIcon(name: string | undefined): LucideIcon | undefined {
  if (!name) return undefined
  return NAV_ICON_MAP[name]
}
