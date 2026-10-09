"use client";

import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { AgentRunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  AgentRunStatus,
  { label: string; className: string; icon: "running" | "done" | "stopped" | "failed" }
> = {
  PENDING: { label: "Queued", className: "bg-muted text-muted-foreground", icon: "running" },
  RUNNING: { label: "Analyzing", className: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]", icon: "running" },
  COMPLETED: { label: "Completed", className: "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]", icon: "done" },
  FAILED: { label: "Failed", className: "bg-[rgba(239,68,68,0.15)] text-[#F87171]", icon: "failed" },
  STOPPED: { label: "Stopped", className: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]", icon: "stopped" },
};

const STATUS_ICONS = {
  running: <Loader2 className="h-3 w-3 animate-spin" aria-hidden />,
  done: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  stopped: <MinusCircle className="h-3 w-3" aria-hidden />,
  failed: <XCircle className="h-3 w-3" aria-hidden />,
};

export const RunBadge = ({ status }: { status: AgentRunStatus }) => {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        meta.className,
      )}
      data-testid={`run-badge-${status.toLowerCase()}`}
    >
      {STATUS_ICONS[meta.icon]}
      {meta.label}
    </span>
  );
};