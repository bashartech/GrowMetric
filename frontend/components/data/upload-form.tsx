"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import type { DataSourceDTO, ImportJobDTO } from "@/lib/types";

interface UploadFormProps {
  onUploadComplete?: (result: { dataSource: DataSourceDTO; import: ImportJobDTO }) => void;
}

export function UploadForm({ onUploadComplete }: UploadFormProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) return;

    const maxSize = 25 * 1024 * 1024; // 25 MB
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
    if (!name) {
      setName(selectedFile.name.replace(/\.[^.]+$/, ""));
    }
    setError(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !name.trim()) {
      setError("Please provide a name and select a file");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("file", file);

      const result = await api.upload<{ dataSource: DataSourceDTO; import: ImportJobDTO }>(
        "/data-sources",
        formData,
      );

      setName("");
      setFile(null);
      onUploadComplete?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Data Source Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Sales Data Q1 2024"
          disabled={uploading}
          required
        />
      </div>

      <div>
        <Label>File</Label>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive ? "border-[#3B82F6] bg-[rgba(59,130,246,0.15)]" : "border-border"
          } ${uploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => !uploading && document.getElementById("file-input")?.click()}
        >
          <Upload className="mx-auto h-12 w-12 text-muted-foreground/70" />
          <p className="mt-2 text-sm text-muted-foreground">
            {file ? (
              <span className="font-medium text-foreground">{file.name}</span>
            ) : (
              <>
                <span className="font-medium">Click to upload</span> or drag and drop
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">CSV or Excel (XLSX) up to 25MB</p>
          <input
            id="file-input"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            disabled={uploading}
            className="hidden"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-[rgba(239,68,68,0.15)] p-3">
          <p className="text-sm text-[#F87171]">{error}</p>
        </div>
      )}

      <Button type="submit" loading={uploading} disabled={!file || !name.trim() || uploading}>
        {uploading ? "Uploading..." : "Upload and Import"}
      </Button>
    </form>
  );
}
