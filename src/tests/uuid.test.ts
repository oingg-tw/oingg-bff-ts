import { describe, expect, it } from "vitest";
import { parseUuidParam } from "@/shared/uuid.js";

describe("parseUuidParam", () => {
  it("accepts a well-formed UUID (case-insensitive) and returns it unchanged", () => {
    const uuid = "aaaaaaaa-0000-4000-8000-000000000001";
    expect(parseUuidParam(uuid, "widget")).toBe(uuid);
    expect(parseUuidParam(uuid.toUpperCase(), "widget")).toBe(uuid.toUpperCase());
  });

  it.each(["1", "not-a-uuid", "aaaaaaaa-0000-4000-8000-00000000000", "aaaaaaaa00004000800000000001", ""])(
    "rejects a non-UUID-shaped value with a 400: %p",
    (value) => {
      expect(() => parseUuidParam(value, "widget")).toThrow(expect.objectContaining({ statusCode: 400 }));
    },
  );

  it("includes the resource name and raw value in the error message", () => {
    expect(() => parseUuidParam("42", "holding")).toThrow('Invalid holding id "42"');
  });
});
