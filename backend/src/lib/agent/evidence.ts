import type { EvidenceClass } from "@prisma/client";

export const EVIDENCE_CLASSES = [
  "OBSERVED",
  "CALCULATED",
  "INFERRED",
  "PROJECTED",
  "RECOMMENDED",
] as const satisfies readonly EvidenceClass[];

export interface RecordedToolOutput {
  toolName: string;
  /** JSON-serialized sanitized output. */
  output: string;
  /** Optional numeric figures a tool reported. */
  figures?: Array<{ value: number; label?: string }>;
}

export interface EvidenceFigure {
  value: number;
  units?: string;
  label?: string;
  sourceTool: string;
}

export interface EvidenceLabelResult {
  evidenceClass: EvidenceClass;
  figures: EvidenceFigure[];
}

/**
 * Labels assistant figures by evidence class (FR-003). Values that exactly
 * match a recorded tool output are CALCULATED/OBSERVED (computed) figures;
 * any proposition describing a figure with no tool support is flagged so the
 * answer can be stored as uncertified.
 */
export function classifyFiguresFor(
  content: string,
  recorded: RecordedToolOutput[],
): EvidenceLabelResult {
  const figures = extractFigures(content);
  const supported: EvidenceFigure[] = [];
  let unsupported = false;

  for (const figure of figures) {
    const source = sourceToolFor(recorded, figure.value);
    if (source) {
      supported.push({ ...figure, sourceTool: source });
    } else {
      unsupported = true;
    }
  }

  if (unsupported) {
    return { evidenceClass: "INFERRED", figures: supported };
  }
  return {
    evidenceClass: figures.length > 0 ? "CALCULATED" : "OBSERVED",
    figures: figures.map((figure) => ({
      ...figure,
      sourceTool: sourceToolFor(recorded, figure.value) ?? "unknown",
    })),
  };
}

/**
 * The figures-outside-tool-data guard: returns true when any number in the
 * answer cannot be traced to recorded tool output. The engine uses this to
 * mark the run so stored answers never present foreign figures as fact.
 */
export function hasFiguresOutsideToolData(
  content: string,
  recorded: RecordedToolOutput[],
): boolean {
  const figures = extractFigures(content);
  return figures.some((figure) => !containsFigure(recorded, figure.value));
}

export function extractFigures(content: string): Array<{ value: number }> {
  const unitSignaled =
    content.match(
      /(?<![A-Za-z0-9_.])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?=[\s,;)\]}]*(?:percent|thousand|million|billion|usd|eur|gbp|cad|\$|€|£)|[\s,;)\]}]*(?:%|k|m|b)(?!\w))/gi,
    ) ?? [];
  const grouped =
    content.match(
      /(?<![A-Za-z0-9_.,])(?:\d{1,3},\d{3}(?:,\d{3})+|\d{1,3},\d{3}(?:\.\d+)?)(?![\w])/g,
    ) ?? [];

  const seen = new Set<number>();
  const figures: Array<{ value: number }> = [];
  for (const match of [...unitSignaled, ...grouped]) {
    const value = normalizeFigure(match);
    if (!Number.isFinite(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    figures.push({ value });
  }
  return figures;
}

function normalizeFigure(raw: string): number {
  let cleaned = raw;
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+(\.\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  return Number(cleaned);
}

function sourceToolFor(recorded: RecordedToolOutput[], value: number): string | null {
  const tolerance = Math.max(1e-6, Math.abs(value) * 1e-4);
  for (const item of recorded) {
    if (item.figures?.some((figure) => Math.abs(figure.value - value) <= tolerance)) {
      return item.toolName;
    }
    if (item.output.includes(String(value))) {
      return item.toolName;
    }
    const rounded = String(Math.round(value));
    if (rounded !== "0" && item.output.includes(rounded)) {
      return item.toolName;
    }
  }
  return null;
}

function containsFigure(recorded: RecordedToolOutput[], value: number): boolean {
  return sourceToolFor(recorded, value) !== null;
}