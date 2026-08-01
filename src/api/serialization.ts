export function serializeApiValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(serializeApiValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeApiValue(item)]),
    );
  }
  return value;
}
