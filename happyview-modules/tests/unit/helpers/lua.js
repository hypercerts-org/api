/**
 * Encodes a JS value as a Lua literal for test fixtures. `null` becomes `nil`
 * and object keys whose value is `undefined` are omitted, which Lua treats the
 * same as absent. Anything else without a Lua equivalent throws.
 */
export function lua(value) {
  if (value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(",")}}`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}
