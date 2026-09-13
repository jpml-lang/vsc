/**
 * Render a parsed `.jp` value as indented JSON. Unlike `JSON.stringify` this
 * writes a `bigint` as a plain integer and non-finite numbers as `NaN` /
 * `Infinity`, so nothing a `.jp` file holds is lost or throws. This matches
 * `jpml to-json`.
 */
export function toJson(value: unknown, indent = 2, level = 0): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "number":
      if (Number.isNaN(value)) return "NaN";
      if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
      return JSON.stringify(value);
    case "boolean":
    case "string":
      return JSON.stringify(value);
  }
  const inner = `\n${" ".repeat(indent * (level + 1))}`;
  const outer = `\n${" ".repeat(indent * level)}`;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[${inner}${value.map((v) => toJson(v, indent, level + 1)).join(`,${inner}`)}${outer}]`;
  }
  const entries = Object.entries(value as object).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}: ${toJson(v, indent, level + 1)}`);
  return `{${inner}${body.join(`,${inner}`)}${outer}}`;
}
