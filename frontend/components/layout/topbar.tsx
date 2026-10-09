"use client";

import { ChevronDown, Menu, UserRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { ThemeToggle } from "./theme-toggle";
import { useAuth, useSignOut } from "@/hooks/use-auth";

interface TopbarProps {
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, organization, workspace } = useAuth();
  const signOut = useSignOut();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={onMenuClick}
        >
          <Menu className="h-4 w-4" aria-hidden />
        </Button>
        <Link href="/dashboard" className="text-sm font-semibold lg:hidden">
          GrowMetric
        </Link>
        <span className="hidden truncate text-sm text-muted-foreground md:inline">
          {organization?.name}
          {workspace ? ` / ${workspace.name}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Dropdown
          trigger={
            <Button variant="ghost" size="sm" className="gap-2">
              <UserRound className="h-4 w-4" aria-hidden />
              <span className="hidden max-w-40 truncate sm:inline">
                {user?.email}
              </span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          }
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {user?.email}
          </div>
          <DropdownItem
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            {signOut.isPending ? "Signing out..." : "Sign out"}
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
