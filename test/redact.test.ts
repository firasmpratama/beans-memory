import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../src/redact";

describe("redactSecrets", () => {
  test("masks provider keys and webhooks", () => {
    const input = [
      "OPENAI=sk-abcdefghijklmnopqrstuvwxyz012345",
      "GH=ghp_abcdefghijklmnopqrstuvwxyz",
      "AWS=AKIAIOSFODNN7EXAMPLE",
      "SLACK=https://hooks.slack.com/services/T000/B000/abcdefghijklmnop",
      "DISCORD=https://discord.com/api/webhooks/123456789/abcdefghijklmnop",
      "GOOGLE=AIzaSyA1234567890abcdefghijklmnopqrstuv",
    ].join("\n");
    const out = redactSecrets(input);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("hooks.slack.com/services/T000");
    expect(out).not.toContain("/api/webhooks/123456789");
    expect(out).not.toContain("AIzaSyA1234567890");
  });

  test("masks compound env keys and bearer headers", () => {
    const out = redactSecrets(
      [
        "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "MY_API_KEY=super-secret-value",
        "Authorization: Bearer abc.def.ghi",
      ].join("\n"),
    );
    expect(out).toContain("AWS_SECRET_ACCESS_KEY=***");
    expect(out).toContain("MY_API_KEY=***");
    expect(out).toContain("Authorization: Bearer ***");
    expect(out).not.toContain("wJalrXUtnFEMI");
    expect(out).not.toContain("abc.def.ghi");
  });

  test("masks lowercase assignments without touching ordinary text", () => {
    const out = redactSecrets("password=hunter2\nthis is a normal sentence");
    expect(out).toContain("password=***");
    expect(out).toContain("normal sentence");
  });
});
