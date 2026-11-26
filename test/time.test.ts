import { describe, expect, test } from "bun:test";

const previousTimeZone = process.env.TZ;
process.env.TZ = "UTC";
const { localDate, localStamp } = await import("../src/time");
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
});
