import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../src/redact";

// Build fake keys from parts so repository secret scanning does not treat the
// test fixtures as real credentials.
const fake = (...parts: string[]) => parts.join("");

describe("redactSecrets", () => {
  test("masks provider keys and webhooks", () => {
    const openaiBody = "abcdefghijklmnopqrstuvwxyz012345";
    const githubBody = "abcdefghijklmnopqrstuvwxyz";
    const awsBody = "IOSFODNN7EXAMPLE";
    const googleBody = "SyA1234567890abcdefghijklmnopqrstuv";
    const webhookBody = "abcdefghijklmnop";

    const input = [
      `OPENAI=${fake("sk-", openaiBody)}`,
      `GH=${fake("ghp_", githubBody)}`,
      `AWS=${fake("AKIA", awsBody)}`,
      `SLACK=https://hooks.slack.com/services/${fake("T000/B000/", webhookBody)}`,
      `DISCORD=https://discord.com/api/webhooks/${fake("123456789/", webhookBody)}`,
      `GOOGLE=${fake("AIza", googleBody)}`,
    ].join("\n");

    const out = redactSecrets(input);
    expect(out).not.toContain(openaiBody);
    expect(out).not.toContain(githubBody);
    expect(out).not.toContain(awsBody);
    expect(out).not.toContain("hooks.slack.com/services/T000");
    expect(out).not.toContain("/api/webhooks/123456789");
    expect(out).not.toContain(googleBody);
  });

  test("masks compound env keys and bearer headers", () => {
    const awsSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const apiKey = "super-secret-value";
    const bearer = "abc.def.ghi";

    const out = redactSecrets(
      [
        `AWS_SECRET_ACCESS_KEY=${awsSecret}`,
        `MY_API_KEY=${apiKey}`,
        `Authorization: Bearer ${bearer}`,
      ].join("\n"),
    );

    expect(out).toContain("AWS_SECRET_ACCESS_KEY=***");
    expect(out).toContain("MY_API_KEY=***");
    expect(out).toContain("Authorization: Bearer ***");
    expect(out).not.toContain(awsSecret);
    expect(out).not.toContain(bearer);
  });

  test("masks lowercase assignments without touching ordinary text", () => {
    const out = redactSecrets("password=hunter2\nthis is a normal sentence");
    expect(out).toContain("password=***");
    expect(out).toContain("normal sentence");
  });
});
