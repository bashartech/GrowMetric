export type CommitStrategy = "APPEND" | "REPLACE" | "UPSERT";

export interface MergeRow {
  key?: string | null;
}

export interface MergeResult<T> {
  rows: T[];
  added: number;
  replaced: number;
  kept: number;
}

function rowKey(row: { key?: string | null }): string | null {
  if (row.key == null || row.key === "") return null;
  return row.key;
}

/**
 * Pure merge semantics for a re-import commit strategy. The row ordering
 * mirrors the versioned dataset store: incoming rows first, then any prior
 * rows that survived the commit (UPSERT skips prior rows whose key collides
 * with an incoming row).
 */
export function mergeRows<T extends MergeRow>(input: {
  prior: T[];
  incoming: T[];
  commit: CommitStrategy;
}): MergeResult<T> {
  const { prior, incoming, commit } = input;

  if (commit === "REPLACE") {
    return { rows: [...incoming], added: incoming.length, replaced: prior.length, kept: 0 };
  }

  if (commit === "UPSERT") {
    const incomingKeys = new Set(
      incoming.map((row) => rowKey(row)).filter((key): key is string => key !== null),
    );
    const surviving = prior.filter((row) => {
      const key = rowKey(row);
      return key === null || !incomingKeys.has(key);
    });
    return {
      rows: [...incoming, ...surviving],
      added: incoming.length,
      replaced: prior.length - surviving.length,
      kept: surviving.length,
    };
  }

  return {
    rows: [...prior, ...incoming],
    added: incoming.length,
    replaced: 0,
    kept: prior.length,
  };
}