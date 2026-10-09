"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import type { ImportJobDTO } from "@/lib/types";

export type ReimportCommit = "APPEND" | "REPLACE" | "UPSERT";

interface ReimportFormProps {
  datasetId: string;
  columns?: Array<{ name: string }>;
  onReimportComplete?: (result: { import: ImportJobDTO }) => void;
}

const commitOptions: Array<{ value: ReimportCommit; label: string; hint: string }> = [
  { value: "APPEND", label: "Append", hint: "Adds new rows alongside existing rows" },
  { value: "REPLACE", label: "Replace", hint: "Drops existing rows and imports only the file" },
  { value: "UPSERT", label: "Upsert", hint: "Updates rows by key and adds new ones" },
];

export function ReimportForm({ datasetId, columns, onReimportComplete }: ReimportFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [commit, setCommit] = useState<ReimportCommit>("APPEND");
  const [upsertKey, setUpsertKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) return;

    const maxSize = 25 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError("File size must be less than 25 MB");
      return;
    }

    const allowedTypes = [".csv", ".xlsx"];
    const extension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf("."));
    if (!allowedTypes.includes(extension)) {
      setError("Only CSV and Excel (.xlsx) files are supported");
      return;
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError("Please choose a file to re-import");
      return;
    }
    if (commit === "UPSERT" && !upsertKey.trim()) {
      setError("Choose a key column for upsert");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.datasets.reimport(
        datasetId,
        { commit, upsertKey: commit === "UPSERT" ? upsertKey.trim() : undefined },
        file,
      );
      setFile(null);
      setUpsertKey("");
      onReimportComplete?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-import failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="reimport-file-input">File</Label>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            submitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          onClick={() => !submitting && document.getElementById("reimport-file-input")?.click()}
        >
          <Upload className="mx-auto h-10 w-10 text-muted-foreground/70" />
          <p className="mt-2 text-sm text-muted-foreground">
            {file ? (
              <span className="font-medium text-foreground">{file.name}</span>
            ) : (
              <>
                <span className="font-medium">Click to upload</span> a file to re-import
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">CSV or Excel (XLSX) up to 25MB</p>
          <input
            id="reimport-file-input"
            name="file"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            disabled={submitting}
            className="hidden"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="commit">Commit Strategy</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {commitOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setCommit(option.value)}
              className={`rounded-md border p-3 text-left ${
                commit === option.value
                  ? "border-[#3B82F6] bg-[rgba(59,130,246,0.15)] ring-1 ring-primary"
                  : "border-border hover:border-border"
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {commit === "UPSERT" && (
        <div>
          <Label htmlFor="upsert-key">Key Column</Label>
          {columns && columns.length > 0 ? (
            <select
              id="upsert-key"
              value={upsertKey}
              onChange={(e) => setUpsertKey(e.target.value)}
              disabled={submitting}
              className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select a key column</option>
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="upsert-key"
              value={upsertKey}
              onChange={(e) => setUpsertKey(e.target.value)}
              placeholder="e.g., id"
              disabled={submitting}
            />
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-[rgba(239,68,68,0.15)] p-3">
          <p className="text-sm text-[#F87171]">{error}</p>
        </div>
      )}

      <Button type="submit" loading={submitting} disabled={submitting}>
        {submitting ? "Re-importing..." : "Re-import"}
      </Button>
    </form>
  );
}