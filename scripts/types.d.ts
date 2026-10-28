// Shapes shared by the repository scripts (scripts/*.mjs), for their JSDoc. Types only.

/** One changelog fragment (or CHANGELOG.md's Unreleased section), parsed: scripts/changelog.mjs. */
export interface Fragment {
  /** Heading → its Markdown list, trimmed. */
  sections: Map<string, string>;
  problems: string[];
}

/** `{ file: { rule or code: count } }`: the lint-warning and type-error ratchets (scripts/lib/lint-ratchet.mjs). */
export type Counts = Record<string, Record<string, number>>;

/** One diagnostic of `oxlint --format json` (the fields scripts/check-lint-warnings.mjs reads). */
export interface OxlintDiagnostic {
  filename: string;
  code: string;
  severity: string;
}

/** A ratchet's baseline file (scripts/lint-warnings-baseline.json, scripts/type-errors-baseline.json). */
export interface RatchetBaseline {
  $description: string;
  total: number;
  files: Counts;
}

/** A JSON Schema, as far as scripts/json-schema.mjs reads one: `true`, `false` or a schema object. */
export type JsonSchema = boolean | JsonSchemaObject;

/** The keywords scripts/json-schema.mjs checks; any other one is reported as unsupported. */
export interface JsonSchemaObject {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  not?: JsonSchema;
  [keyword: string]: unknown;
}

/** One record of hydrotik's component catalog (docs/llm/catalog.json), as sync-catalog.mjs edits it. */
export interface CatalogRecord {
  /** The path of its context file inside hydrotik: dropped by the copy. */
  context?: string;
  [key: string]: unknown;
}
