const stamp = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" });

export function localStamp(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso.slice(0, 16).replace("T", " ");
  return stamp.format(value);
}

export function localDate(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso.slice(0, 10);
  return dateOnly.format(value);
}

export function normalizeIsoDate(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
