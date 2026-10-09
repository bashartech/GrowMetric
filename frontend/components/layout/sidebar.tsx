"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath, navigation } from "@/lib/navigation";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-6 p-4">
      {navigation.map((section) => (
        <div key={section.title}>
          <h4 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </h4>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-150",
                      active
                        ? "bg-[var(--sidebar-active)] font-medium text-[var(--sidebar-active-foreground)] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25),0_0_16px_-6px_rgba(59,130,246,0.5)]"
                        : "text-[var(--sidebar-foreground)] hover:bg-[var(--surface-hover)] hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        active
                          ? "text-[#60A5FA]"
                          : "text-[var(--sidebar-foreground)] group-hover:text-foreground",
                      )}
                      aria-hidden
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
