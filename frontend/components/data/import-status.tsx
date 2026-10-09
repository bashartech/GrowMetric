"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import type { ImportJobDTO } from "@/lib/types";

interface ImportStatusProps {
  importId: string;
  onComplete?: (importJob: ImportJobDTO) => void;
}

export function ImportStatus({ importId, onComplete }: ImportStatusProps) {
  const [importJob, setImportJob] = useState<ImportJobDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: NodeJS.Timeout;

    const fetchImport = async () => {
      try {
        const data = await api.get<ImportJobDTO>(`/imports/${importId}`);
        if (cancelled) return;

        setImportJob(data);
        setLoading(false);

        // Poll if still in progress
        if (data.status === "QUEUED" || data.status === "RUNNING") {
          timeoutId = setTimeout(fetchImport, 2000);
        } else {
          onComplete?.(data);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Import status unavailable");
        setLoading(false);
      }
    };

    fetchImport();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [importId, onComplete]);

  if (loading && !importJob) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4 animate-spin" />
        Loading import status...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#F87171]">
        <XCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (!importJob) return null;

  const statusConfig = {
    QUEUED: {
      icon: Clock,
      color: "text-muted-foreground",
      bg: "bg-muted",
      label: "Queued",
      animate: false,
    },
    RUNNING: {
      icon: Clock,
      color: "text-[#60A5FA]",
      bg: "bg-[rgba(59,130,246,0.15)]",
      label: "Processing",
      animate: true,
    },
    REQUESTING_MAPPING: {
      icon: AlertCircle,
      color: "text-[#FDE047]",
      bg: "bg-[rgba(250,204,21,0.14)]",
      label: "Needs Confirmation",
      animate: false,
    },
    COMPLETED: {
      icon: CheckCircle,
      color: "text-[#4ADE80]",
      bg: "bg-[rgba(34,197,94,0.15)]",
      label: "Completed",
      animate: false,
    },
    FAILED: {
      icon: XCircle,
      color: "text-[#F87171]",
      bg: "bg-[rgba(239,68,68,0.15)]",
      label: "Failed",
      animate: false,
    },
  };

  const config = statusConfig[importJob.status];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`rounded-full p-1 ${config.bg}`}>
          <Icon className={`h-4 w-4 ${config.color} ${config.animate ? "animate-spin" : ""}`} />
        </div>
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
      </div>

      {importJob.status === "COMPLETED" && importJob.totalRows !== null && (
        <p className="text-sm text-muted-foreground">
          Processed {importJob.totalRows.toLocaleString()} rows
        </p>
      )}

      {importJob.status === "FAILED" && importJob.error && (
        <p className="text-sm text-[#F87171]">{importJob.error}</p>
      )}

      {importJob.status === "REQUESTING_MAPPING" && (
        <p className="text-sm text-[#FDE047]">
          Some columns need manual mapping confirmation
        </p>
      )}
    </div>
  );
}
