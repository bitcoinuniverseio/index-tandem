import { describe, expect, it } from "vitest";
import { serializeApiValue } from "../src/api/serialization.js";

describe("serializeApiValue", () => {
  it("serializes bigint, date, buffer, arrays, and nested records", () => {
    expect(
      serializeApiValue({
        count: 9_007_199_254_740_993n,
        at: new Date("2026-08-01T00:00:00.000Z"),
        hash: Buffer.from("aabb", "hex"),
        nested: [1n, { value: 2n }],
      }),
    ).toEqual({
      count: "9007199254740993",
      at: "2026-08-01T00:00:00.000Z",
      hash: "aabb",
      nested: ["1", { value: "2" }],
    });
  });
});
