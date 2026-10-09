export interface MappingCandidate {
  semanticKey: string;
  businessMeaning: string;
  confidence: number;
}

export interface ColumnMapping {
  columnName: string;
  candidates: MappingCandidate[];
  best: MappingCandidate | null;
  requiresConfirmation: boolean;
}

interface Rule {
  semanticKey: string;
  businessMeaning: string;
  synonyms: string[];
}

export const HIGH_CONFIDENCE = 0.92;
export const CONFIRM_THRESHOLD = 0.85;

/**
 * True when a mapping is confident enough to auto-apply without human
 * confirmation. Low-confidence substring matches are left unmapped so they
 * can flow to the LLM-suggestion or mapping-confirmation flows instead of
 * silently renaming a column (e.g. `name` -> customers, `total_jobs` -> revenue).
 */
export function isAutoApplicable(mapping: ColumnMapping): boolean {
  return Boolean(mapping.best && mapping.best.confidence >= CONFIRM_THRESHOLD);
}

const RULES: readonly Rule[] = [
  {
    semanticKey: "revenue",
    businessMeaning: "Revenue",
    synonyms: ["revenue", "sales", "net_sales", "gross", "amount", "total", "total_amount", "total_revenue", "total_sales", "amount_due"],
  },
  {
    semanticKey: "orders",
    businessMeaning: "Orders",
    synonyms: ["order_id", "orderid", "order_number", "orders", "order_no", "order_count", "order_qty", "total_orders"],
  },
  {
    semanticKey: "customers",
    businessMeaning: "Customers",
    synonyms: ["customer", "customer_id", "client", "cust_id", "customer_name"],
  },
  {
    semanticKey: "products",
    businessMeaning: "Products",
    synonyms: ["product", "product_id", "product_name", "item", "sku", "item_name"],
  },
  {
    semanticKey: "inventory",
    businessMeaning: "Inventory",
    synonyms: ["inventory", "stock", "quantity_on_hand", "units_in_stock", "on_hand"],
  },
  {
    semanticKey: "expenses",
    businessMeaning: "Expenses",
    synonyms: ["expense", "expenses", "cost", "spend", "cost_amount", "total_expenses", "total_cost"],
  },
  {
    semanticKey: "profit",
    businessMeaning: "Profit",
    synonyms: ["profit", "gross_profit", "profit_margin", "net_profit", "profit_amount"],
  },
  {
    semanticKey: "order_date",
    businessMeaning: "Order Date",
    synonyms: ["order_date", "date", "created_at", "transaction_date", "invoice_date", "order_date_time"],
  },
  {
    semanticKey: "region",
    businessMeaning: "Region",
    synonyms: ["region", "country", "state", "territory", "area"],
  },
  {
    semanticKey: "category",
    businessMeaning: "Category",
    synonyms: ["category", "product_category", "class", "segment"],
  },
  {
    semanticKey: "quantity",
    businessMeaning: "Quantity",
    synonyms: ["quantity", "qty", "units_sold", "units", "quantity_sold"],
  },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export const CANONICAL_SEMANTIC_KEYS: readonly string[] = RULES.map(
  (rule) => rule.semanticKey,
);

export function mappingCandidatesForName(
  columnName: string,
): MappingCandidate[] {
  const normalized = normalizeName(columnName);
  const candidates: MappingCandidate[] = [];

  for (const rule of RULES) {
    if (rule.synonyms.includes(normalized)) {
      candidates.push({
        semanticKey: rule.semanticKey,
        businessMeaning: rule.businessMeaning,
        confidence: HIGH_CONFIDENCE,
      });
      continue;
    }
    const partial = rule.synonyms.filter(
      (synonym) =>
        normalized.includes(synonym) || synonym.includes(normalized),
    );
    if (partial.length > 0) {
      candidates.push({
        semanticKey: rule.semanticKey,
        businessMeaning: rule.businessMeaning,
        confidence: 0.7,
      });
    }
  }

  const unique = new Map<string, MappingCandidate>();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.semanticKey);
    if (!existing || candidate.confidence > existing.confidence) {
      unique.set(candidate.semanticKey, candidate);
    }
  }
  return Array.from(unique.values()).sort(
    (a, b) => b.confidence - a.confidence,
  );
}

const NUMERIC_SEMANTIC_KEYS = new Set([
  "revenue",
  "orders",
  "quantity",
  "inventory",
  "profit",
  "expenses",
]);
const DATE_SEMANTIC_KEYS = new Set(["order_date"]);

function demoteMismatch(
  candidate: MappingCandidate,
  profileType: string,
): MappingCandidate {
  if (NUMERIC_SEMANTIC_KEYS.has(candidate.semanticKey)) {
    const numeric = profileType === "INTEGER" || profileType === "DECIMAL";
    if (!numeric) {
      return { ...candidate, confidence: Math.min(candidate.confidence, 0.8) };
    }
  }
  if (DATE_SEMANTIC_KEYS.has(candidate.semanticKey)) {
    const temporal =
      profileType === "DATE" ||
      profileType === "TIME" ||
      profileType === "TIMESTAMP";
    if (!temporal) {
      return { ...candidate, confidence: Math.min(candidate.confidence, 0.8) };
    }
  }
  return candidate;
}

export function mapColumn(
  columnName: string,
  profileType: string,
): ColumnMapping {
  const candidates = mappingCandidatesForName(columnName);
  const rawBest = candidates[0] ?? null;
  const best = rawBest ? demoteMismatch(rawBest, profileType) : null;
  const requiresConfirmation = Boolean(
    best &&
      candidates.length > 1 &&
      best.confidence < CONFIRM_THRESHOLD,
  );
  return { columnName, candidates, best, requiresConfirmation };
}

export function mapColumns(
  headers: string[],
  profileTypes: string[],
): ColumnMapping[] {
  return headers.map((header, index) =>
    mapColumn(header, profileTypes[index] ?? "TEXT"),
  );
}