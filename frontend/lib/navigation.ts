import {
  Bell,
  Bot,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    title: "Analyze",
    items: [
      // { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard", label: "Dashboard", icon: LineChart },
      { href: "/ai-analyst", label: "AI Analyst", icon: Bot },
      { href: "/investigations", label: "Investigations", icon: Search },
      { href: "/simulator", label: "Simulator", icon: FlaskConical },
      { href: "/recommendations", label: "Recommendations", icon: Lightbulb },
    ],
  },
  {
    title: "Monitor",
    items: [
      { href: "/alerts", label: "Alerts", icon: Bell },
      { href: "/alert-rules", label: "Alert Rules", icon: ShieldCheck },
      { href: "/notifications", label: "Notifications", icon: Inbox },
    ],
  },
  {
    title: "Reports",
    items: [
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/report-schedules", label: "Report Schedules", icon: ClipboardList },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/data-hub/datasets", label: "Datasets", icon: Table2 },
      { href: "/data-hub/data-sources", label: "Data Sources", icon: Plug },
      { href: "/data-hub/data-quality", label: "Data Quality", icon: ShieldCheck },
      { href: "/data-hub/imports", label: "Import History", icon: ClipboardList },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/audit-logs", label: "Audit Logs", icon: Database },
      { href: "/settings", label: "Settings", icon: Settings },
      // { href: "/billing", label: "Billing", icon: CreditCard },
    ],
  },
];

export const navigationItems: NavItem[] = navigation.flatMap(
  (section) => section.items,
);

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
