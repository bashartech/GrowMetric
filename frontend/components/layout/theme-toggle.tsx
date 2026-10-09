"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";

function subscribe() {
  return () => {};
}

function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const TriggerIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <Dropdown
      trigger={
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          {mounted ? (
            <TriggerIcon className="h-4 w-4" aria-hidden />
          ) : (
            <Monitor className="h-4 w-4" aria-hidden />
          )}
        </Button>
      }
    >
      <DropdownItem onClick={() => setTheme("light")}>
        <Sun className="h-4 w-4" aria-hidden /> Light
      </DropdownItem>
      <DropdownItem onClick={() => setTheme("dark")}>
        <Moon className="h-4 w-4" aria-hidden /> Dark
      </DropdownItem>
      <DropdownItem onClick={() => setTheme("system")}>
        <Monitor className="h-4 w-4" aria-hidden /> System
      </DropdownItem>
    </Dropdown>
  );
}
