import { describe, expect, test } from "bun:test";

const previousTimeZone = process.env.TZ;
process.env.TZ = "UTC";
const { localDate, localStamp, normalizeIsoDate } = await import("../src/time");
if (previousTimeZone === undefined) {
  delete process.env.TZ;
} else {
  process.env.TZ = previousTimeZone;
}

describe("local time formatting", () => {
  test("formats a known UTC instant as a local timestamp and date", () => {
    const instant = "2026-01-02T03:04:00.000Z";

    expect(localStamp(instant)).toBe("2026-01-02 03:04");
    expect(localDate(instant)).toBe("2026-01-02");
  });

  test("preserves a readable prefix for malformed timestamps", () => {
    expect(localStamp("bad-date-value")).toBe("bad-date-value");
    expect(localDate("bad-date-value")).toBe("bad-date-v");
    expect(localStamp("")).toBe("");
    expect(localDate("")).toBe("");
  });

  test("normalizes numbers, strings, and invalid date inputs", () => {
    const epoch = Date.UTC(2026, 0, 2, 3, 4);
    expect(normalizeIsoDate(epoch)).toBe("2026-01-02T03:04:00.000Z");
    expect(normalizeIsoDate("2026-01-02T03:04:00.000Z")).toBe("2026-01-02T03:04:00.000Z");
    expect(normalizeIsoDate(undefined)).toBeUndefined();
    expect(normalizeIsoDate(null)).toBeNull();
    expect(normalizeIsoDate("")).toBeNull();
    expect(normalizeIsoDate("not-a-date")).toBeNull();
  });
});
