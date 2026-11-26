const PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{20,}/g, "sk-***"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh*_***"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA***"],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, "https://hooks.slack.com/services/***"],
  [/https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g, "https://discord.com/api/webhooks/***"],
  [/xox[baprs]-[A-Za-z0-9-]+/g, "xox*-***"],
  [/AIza[0-9A-Za-z_-]{35}/g, "AIza***"],
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer ***"],
  [
    /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*["']?)[^\s"',]{6,}/gi,
    "$1***",
  ],
  [
    /(?<=\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']?)[^\s"',]{6,}/gi,
    "***",
  ],
];

export function redactSecrets(text: string): string {
  let value = text;
  for (const [pattern, replacement] of PATTERNS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}
