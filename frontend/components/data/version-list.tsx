"use client";

import type { DatasetVersionDTO } from "@/lib/types";

interface VersionListProps {
  versions: DatasetVersionDTO[];
  currentVersionId: string | null;
}

const commitLabels: Record<DatasetVersionDTO["commit"], string> = {
  APPEND: "Append",
  REPLACE: "Replace",
  UPSERT: "Upsert",
};

const commitStyles: Record<DatasetVersionDTO["commit"], string> = {
  APPEND: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]",
  REPLACE: "bg-[rgba(124,58,237,0.15)] text-[#A78BFA]",
  UPSERT: "bg-[rgba(34,211,238,0.15)] text-[#22D3EE]",
};

export function VersionList({ versions, currentVersionId }: VersionListProps) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground/70">No versions recorded yet.</p>;
  }

  return (
    <ol className="space-y-2">
      {versions.map((version) => {
        const isCurrent = version.id === currentVersionId;
        return (
          <li
            key={version.id}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
              isCurrent ? "border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.15)]" : "border-border"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  isCurrent ? "bg-[#3B82F6]" : "bg-muted-foreground/40"
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">Version {version.version}</p>
                <p className={`text-xs ${isCurrent ? "text-[#60A5FA]" : "text-muted-foreground"}`}>
                  {new Date(version.createdAt).toLocaleString()} &middot; {version.source}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${commitStyles[version.commit]}`}
              >
                {commitLabels[version.commit]}
              </span>
              {isCurrent ? (
                <span className="rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] px-1.5 py-0.5 text-xs font-medium text-white">
                  Current
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}