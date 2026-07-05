import type { UrlScopeRule } from "./types";

export function inferDatabaseFromUrl(url: string, rules: UrlScopeRule[] = []): string | null {
  for (const rule of rules) {
    if (matchesPattern(url, rule.urlPattern)) return rule.database;
  }

  const parsed = safeUrl(url);
  if (!parsed) return null;

  const path = parsed.pathname;
  const rdsMatch = path.match(/\/rds\/detail\/db\/[^/]+\/([^/]+)(?:\/|$)/i);
  if (rdsMatch) return decodeURIComponent(rdsMatch[1]);

  const dbPathMatch = path.match(/\/(?:db|database|schema)\/([^/]+)(?:\/|$)/i);
  if (dbPathMatch) return decodeURIComponent(dbPathMatch[1]);

  for (const key of ["db", "database", "schema"]) {
    const value = parsed.searchParams.get(key);
    if (value) return value;
  }

  return null;
}

export function createUrlPattern(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) return url;
  return `${parsed.origin}${parsed.pathname.replace(/\/[^/]*$/, "/*")}`;
}

export function matchesPattern(url: string, pattern: string): boolean {
  if (!pattern.trim()) return false;
  const escaped = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${escaped}$`, "i").test(url);
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
