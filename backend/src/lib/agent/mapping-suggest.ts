import { z } from "zod";
import { MAPPING_ASSIST_SYSTEM, MAPPING_ASSIST_SYSTEM_VERSION } from "./prompts.js";
import { CANONICAL_SEMANTIC_KEYS } from "../mapping-rules.js";

export const MAPPING_SUGGESTION_MIN_CONFIDENCE = 0.5;
export const MAPPING_SUGGESTION_MAX_CANDIDATES = 2;

export const mappingSuggestionSchema = z.object({
  semanticKey: z.string(),
  businessMeaning: z.string(),
  confidence: z.number(),
});

const rawSuggestionSchema = z
  .object({
    semanticKey: z.string().optional(),
    businessMeaning: z.string().optional(),
    confidence: z.number().optional(),
  })
  .optional()
  .nullable();

export interface MappingSuggestionAnswer {
  semanticKey: string;
  businessMeaning: string;
  confidence: number;
}

export interface SuggestMappingResult {
  model: string;
  promptVersion: string;
  candidates: MappingSuggestionAnswer[];
  malformed: boolean;
}

export function buildSuggestMappingContext(columnName: string): {
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
} {
  return {
    systemPrompt: MAPPING_ASSIST_SYSTEM,
    userPrompt: `Suggest a mapping for the imported column named "${columnName}".\n
Answer ONLY with the JSON shape: {"semanticKey":"<key>","businessMeaning":"<meaning>","confidence":<0.0-1.0>}.
Choose keys only from this canonical vocabulary: ${CANONICAL_SEMANTIC_KEYS.join(", ")}.
Up to ${MAPPING_SUGGESTION_MAX_CANDIDATES} candidates, or null when no confident mapping exists.`,
    promptVersion: MAPPING_ASSIST_SYSTEM_VERSION,
  };
}

/**
 * Validates provider output for SUGGEST_MAPPING. Malformed or
 * out-of-vocabulary candidates are skipped safely (FR-012); a non-JSON
 * response yields an empty candidate list, never a stored bad mapping.
 */
export function parseMappingSuggestionOutput(
  content: string,
): MappingSuggestionAnswer[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const window = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    parsed = JSON.parse(window);
  } catch {
    return [];
  }

  const payload = parsed as { candidates?: unknown };
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.candidates)
      ? payload.candidates
      : [payload];

  const candidates: MappingSuggestionAnswer[] = [];
  for (const raw of rawList) {
    const parsedItem = rawSuggestionSchema.safeParse(raw);
    if (!parsedItem.success) continue;
    const item = parsedItem.data;
    if (!item?.semanticKey || !item.businessMeaning) continue;
    const confidence = item.confidence;
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < MAPPING_SUGGESTION_MIN_CONFIDENCE ||
      confidence > 1
    ) {
      continue;
    }
    if (!CANONICAL_SEMANTIC_KEYS.includes(item.semanticKey)) continue;
    if (candidates.some((candidate) => candidate.semanticKey === item.semanticKey)) continue;
    candidates.push({
      semanticKey: item.semanticKey,
      businessMeaning: item.businessMeaning,
      confidence: round(confidence),
    });
    if (candidates.length >= MAPPING_SUGGESTION_MAX_CANDIDATES) break;
  }

  return candidates;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}