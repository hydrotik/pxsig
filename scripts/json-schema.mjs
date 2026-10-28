/**
 * json-schema.mjs — a small JSON Schema (2020-12) checker for the keywords pxsig's committed data
 * files use, so checking them needs no dependency. Supported: type, enum, const, required,
 * properties, additionalProperties, propertyNames, items, minItems, uniqueItems, minLength,
 * maxLength, pattern, if/then/else, not. Annotations ($schema, $id, title, description, format) are
 * ignored; any other keyword is an error, so a schema never passes by being misread.
 */
/** @import { JsonSchema } from './types.js' */
const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'format',
  'default',
  'examples',
]);
const KNOWN = new Set([
  ...ANNOTATIONS,
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'propertyNames',
  'items',
  'minItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'if',
  'then',
  'else',
  'not',
]);

/** @param {unknown} v */
const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
/**
 * @param {unknown} v
 * @param {string} t
 */
const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

/**
 * The errors of `data` against `schema`, as `<path> <message>` strings; empty when it passes.
 * @param {JsonSchema} schema
 * @param {unknown} data
 * @param {string} [at]
 * @returns {string[]}
 */
export function validate(schema, data, at = '') {
  if (schema === true) return [];
  if (schema === false) return [`${at || '/'} is not allowed`];
  /** @type {string[]} */
  const errs = [];
  const here = at || '/';
  for (const k of Object.keys(schema))
    if (!KNOWN.has(k)) errs.push(`${here} schema keyword "${k}" is not supported`);
  if (schema.type !== undefined) {
    const types = /** @type {string[]} */ ([]).concat(schema.type);
    if (!types.some((t) => isType(data, t)))
      return [...errs, `${here} must be ${types.join(' or ')}`];
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(data)))
    errs.push(`${here} must be one of ${schema.enum.join(', ')}`);
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(data))
    errs.push(`${here} must be ${JSON.stringify(schema.const)}`);
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength)
      errs.push(`${here} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && data.length > schema.maxLength)
      errs.push(`${here} is longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data))
      errs.push(`${here} must match ${schema.pattern}`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems)
      errs.push(`${here} must have at least ${schema.minItems} items`);
    // Array.isArray narrows `unknown` to any[]: its items are unknown.
    if (
      schema.uniqueItems &&
      new Set(/** @type {unknown[]} */ (data).map((x) => JSON.stringify(x))).size !== data.length
    )
      errs.push(`${here} must have unique items`);
    if (schema.items !== undefined)
      /** @type {unknown[]} */ (data).forEach((x, i) =>
        // Checked on the line above; the callback does not keep the narrowing.
        errs.push(...validate(/** @type {JsonSchema} */ (schema.items), x, `${at}/${i}`))
      );
  }
  if (typeOf(data) === 'object') {
    // typeOf: a non-null, non-array object.
    for (const r of schema.required ?? [])
      if (!(r in /** @type {object} */ (data)))
        errs.push(`${here} must have required property '${r}'`);
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (data))) {
      const path = `${at}/${k}`;
      if (schema.propertyNames) errs.push(...validate(schema.propertyNames, k, `${path} (name)`));
      if (schema.properties && k in schema.properties)
        errs.push(...validate(schema.properties[k], v, path));
      else if (schema.additionalProperties !== undefined)
        errs.push(...validate(schema.additionalProperties, v, path));
    }
  }
  if (schema.if !== undefined) {
    const branch = validate(schema.if, data, at).length === 0 ? schema.then : schema.else;
    if (branch !== undefined) errs.push(...validate(branch, data, at));
  }
  if (schema.not !== undefined && validate(schema.not, data, at).length === 0)
    errs.push(`${here} must not match the "not" schema`);
  return errs;
}
