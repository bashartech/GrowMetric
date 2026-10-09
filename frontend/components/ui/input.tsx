import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type ?? "text"}
    className={cn(
      "flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:border-[var(--ring)] focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.15)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
