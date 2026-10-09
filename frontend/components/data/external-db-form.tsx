"use client";

import { useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { parseConnectionUrl } from "@/lib/external-db";
import type {
  DataSourceDTO,
  ExternalDbTableDTO,
  ImportJobDTO,
} from "@/lib/types";

const SSL_MODE_OPTIONS = [
  { value: "require", label: "Require (SSL)" },
  { value: "prefer", label: "Prefer (SSL if available)" },
  { value: "disable", label: "Disable" },
] as const;

const SYNC_MODE_OPTIONS = [
  { value: "REPLACE", label: "Replace (snapshot)" },
  { value: "UPSERT", label: "Upsert (merge by key)" },
] as const;

const DEFAULT_PORT = 5432;

interface ExternalDbFormProps {
  onConnected?: (dataSource: DataSourceDTO) => void;
  onSyncComplete?: (importJobs: ImportJobDTO[]) => void;
}

export const ExternalDbForm = ({
  onConnected,
  onSyncComplete,
}: ExternalDbFormProps) => {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState<"require" | "prefer" | "disable">("require");
  const [connecting, setConnecting] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<DataSourceDTO | null>(null);
  const [tables, setTables] = useState<ExternalDbTableDTO[] | null>(null);
  const [syncResult, setSyncResult] = useState<ImportJobDTO[] | null>(null);

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextHost = e.target.value;
    setHost(nextHost);

    const parsed = parseConnectionUrl(nextHost);
    if (!parsed) return;
    setPort(String(parsed.port));
    if (parsed.database) setDatabase(parsed.database);
    if (parsed.username) setUsername(parsed.username);
    if (parsed.password) setPassword(parsed.password);
    setSslMode(parsed.sslMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsedHost = parseConnectionUrl(host);
    const effectiveHost = parsedHost ? parsedHost.host : host.trim();
    const effectivePort = parsedHost
      ? parsedHost.port
      : Number.parseInt(port, 10);
    const effectiveDatabase = parsedHost
      ? parsedHost.database || database.trim()
      : database.trim();
    const effectiveUsername = parsedHost
      ? parsedHost.username || username.trim()
      : username.trim();
    const effectivePassword = parsedHost
      ? parsedHost.password || password
      : password;

    if (
      !name.trim() ||
      !host.trim() ||
      !effectiveDatabase ||
      !effectiveUsername ||
      !effectivePassword ||
      Number.isNaN(effectivePort) ||
      effectivePort < 1 ||
      effectivePort > 65535
    ) {
      setError("Please fill in all connection fields with a valid port");
      return;
    }

    setConnecting(true);
    setError(null);
    setSyncResult(null);

    try {
      const result = await api.dataSources.createExternalDb({
        name: name.trim(),
        host: effectiveHost,
        port: effectivePort,
        database: effectiveDatabase,
        username: effectiveUsername,
        password: effectivePassword,
        sslMode,
      });

      setSource(result.dataSource);
      setConnecting(false);
      setLoadingTables(true);

      const tablesResult = await api.dataSources.listTables(result.dataSource.id);
      setTables(
        (tablesResult.tables ?? []).map((table) => ({
          ...table,
          syncMode: table.syncMode ?? "REPLACE",
          upsertKeyColumnName: table.upsertKeyColumnName ?? null,
        })),
      );
      setLoadingTables(false);
      onConnected?.(result.dataSource);
    } catch (err) {
      setConnecting(false);
      setLoadingTables(false);
      setError(err instanceof Error ? err.message : "Connection failed. Please try again.");
    }
  };

  const handleToggle = (schemaName: string, tableName: string) => {
    setTables((prev) =>
      prev
        ? prev.map((table) =>
            table.schemaName === schemaName && table.tableName === tableName
              ? { ...table, isSelected: !table.isSelected }
              : table,
          )
        : prev,
    );
  };

  const updateTableFields = (
    schemaName: string,
    tableName: string,
    patch: Partial<ExternalDbTableDTO>,
  ) => {
    setTables((prev) =>
      prev
        ? prev.map((table) =>
            table.schemaName === schemaName && table.tableName === tableName
              ? { ...table, ...patch }
              : table,
          )
        : prev,
    );
  };

  const handleSync = async () => {
    if (!source || !tables) return;

    const selected = tables.filter((table) => table.isSelected);
    if (selected.length === 0) {
      setError("Select at least one table to sync");
      return;
    }

    const missingKey = selected.find(
      (table) =>
        table.syncMode === "UPSERT" && !(table.upsertKeyColumnName ?? "").trim(),
    );
    if (missingKey) {
      setError(
        `Upsert needs a key column for ${missingKey.schemaName}.${missingKey.tableName} — e.g. order_id. New rows are added and matching rows updated, never duplicated.`,
      );
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      await api.dataSources.updateTableSelection(
        source.id,
        {
          tables: tables.map(({ schemaName, tableName, isSelected, syncMode, upsertKeyColumnName }) => ({
            schemaName,
            tableName,
            isSelected,
            syncMode,
            upsertKeyColumnName: upsertKeyColumnName ?? null,
          })),
        },
      );
      const result = await api.dataSources.sync(source.id);
      setSyncResult(result.importJobs);
      onSyncComplete?.(result.importJobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const handleBack = () => {
    setSource(null);
    setTables(null);
    setSyncResult(null);
    setError(null);
  };

  if (source && tables) {
    const selectedCount = tables.filter((table) => table.isSelected).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[rgba(59,130,246,0.15)] rounded-lg">
              <Database className="h-5 w-5 text-[#60A5FA]" />
            </div>
            <div>
              <h3 className="font-semibold">{source.name}</h3>
              <p className="text-sm text-muted-foreground">
                Connected · SELECT {String(tables.length)} table
                {tables.length === 1 ? "" : "s"} to import
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleBack}>
            Change connection
          </Button>
        </div>

        {syncResult && syncResult.length > 0 && (
          <div className="rounded-md bg-[rgba(59,130,246,0.15)] border border-[rgba(59,130,246,0.35)] p-4">
            <h4 className="text-sm font-medium text-[#93C5FD]">Sync started</h4>
            <ul className="mt-2 space-y-1 text-sm text-[#60A5FA]">
              {syncResult.map((job) => (
                <li key={job.id}>
                  {job.filename} — {job.status}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Table</th>
                <th className="px-4 py-2 font-medium">Rows (est.)</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Upsert Key</th>
                <th className="px-4 py-2 font-medium">Import</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tables.map((table) => (
                <tr key={table.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{table.tableName}</div>
                    <div className="text-xs text-muted-foreground">
                      {table.schemaName} · {table.columnCount} columns
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {table.rowEstimate.toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={table.syncMode}
                      onChange={(e) =>
                        updateTableFields(table.schemaName, table.tableName, {
                          syncMode: e.target.value as "REPLACE" | "UPSERT",
                        })
                      }
                      disabled={syncing || !table.isSelected}
                      aria-label={`Sync mode for ${table.tableName}`}
                      className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {SYNC_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {table.syncMode === "UPSERT" ? (
                      <input
                        value={table.upsertKeyColumnName ?? ""}
                        onChange={(e) =>
                          updateTableFields(table.schemaName, table.tableName, {
                            upsertKeyColumnName: e.target.value,
                          })
                        }
                        disabled={syncing || !table.isSelected}
                        placeholder="e.g. order_id"
                        aria-label={`Upsert key column for ${table.tableName}`}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground/70">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        id={`table-${table.id}`}
                        type="checkbox"
                        checked={table.isSelected}
                        onChange={() => handleToggle(table.schemaName, table.tableName)}
                        disabled={syncing}
                        aria-label={`Import ${table.schemaName}.${table.tableName}`}
                      />
                      <span>{table.isSelected ? "Selected" : "Off"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div className="rounded-md bg-[rgba(239,68,68,0.15)] p-3">
            <p className="text-sm text-[#F87171]">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground">
            {selectedCount} of {tables.length} selected
          </span>
          <Button type="button" onClick={handleSync} loading={syncing} disabled={syncing}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {syncing ? "Starting Sync..." : "Sync Selected Tables"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="external-db-name">Data Source Name</Label>
          <Input
            id="external-db-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Production PostgreSQL"
            disabled={connecting}
            required
          />
        </div>
        <div>
          <Label htmlFor="external-db-host">Host</Label>
          <Input
            id="external-db-host"
            value={host}
            onChange={handleHostChange}
            placeholder="e.g., ep-xxxx.region.aws.neon.tech"
            disabled={connecting}
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            You can paste the whole connection string here — e.g.,{" "}
            <code className="text-[11px]">postgresql://user:np****tM9@host:5432/db</code>{" "}
            — the port, database and credentials below are filled automatically.
          </p>
        </div>
        <div>
          <Label htmlFor="external-db-port">Port</Label>
          <Input
            id="external-db-port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={connecting}
            required
          />
        </div>
        <div>
          <Label htmlFor="external-db-database">Database</Label>
          <Input
            id="external-db-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="e.g., analytics"
            disabled={connecting}
            required
          />
        </div>
        <div>
          <Label htmlFor="external-db-username">Username</Label>
          <Input
            id="external-db-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="readonly_user"
            disabled={connecting}
            required
          />
        </div>
        <div>
          <Label htmlFor="external-db-password">Password</Label>
          <Input
            id="external-db-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={connecting}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="external-db-ssl">SSL Mode</Label>
        <select
          id="external-db-ssl"
          value={sslMode}
          onChange={(e) => setSslMode(e.target.value as "require" | "prefer" | "disable")}
          disabled={connecting}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SSL_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md bg-[rgba(239,68,68,0.15)] p-3">
          <p className="text-sm text-[#F87171]">{error}</p>
        </div>
      )}

      <Button type="submit" loading={connecting || loadingTables} disabled={connecting || loadingTables}>
        {connecting || loadingTables ? "Connecting..." : "Connect Database"}
      </Button>
    </form>
  );
};