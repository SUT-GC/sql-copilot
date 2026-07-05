import type { DbSkill, TemplateVariableType } from "../types";
import { filterTablesByDatabase, getSkillSuggestions } from "../skill";

export type WorkspaceState = {
  sql: string;
  database: string | null;
};

export type Suggestion = {
  label: string;
  detail: string;
  insertText: string;
};

export const VARIABLE_TYPES: TemplateVariableType[] = [
  "text",
  "number",
  "date",
  "date_range",
  "select",
  "multi_select",
  "table",
  "column",
  "metric",
  "sql_fragment"
];

const SQL_KEYWORDS: Suggestion[] = [
  "select",
  "from",
  "where",
  "left join",
  "inner join",
  "on",
  "group by",
  "order by",
  "limit",
  "count(distinct )",
  "sum()",
  "date_format()"
].map((keyword) => ({ label: keyword, detail: "SQL keyword", insertText: keyword }));

export function getDatabaseOptions(skill: DbSkill | null): string[] {
  if (!skill) return [];
  const names = new Set<string>();
  for (const table of skill.tables) {
    for (const database of splitDatabaseNames(table.database)) {
      names.add(database);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function getWorkspaceSuggestions(skill: DbSkill | null, token: string, database: string | null, sql: string, tokenStart: number): Suggestion[] {
  const context = inferSuggestionContext(sql.slice(0, tokenStart));
  if (!token.trim() && context !== "table") return [];
  if (context === "table") return getTableSuggestions(skill, token, database).slice(0, 8);

  const needle = token.toLowerCase();
  const keywordSuggestions = SQL_KEYWORDS.filter((item) => item.label.toLowerCase().includes(needle));
  return [...keywordSuggestions, ...getSkillSuggestions(skill, token, database)].slice(0, 8);
}

export function getCurrentToken(sql: string, cursor: number): { value: string; start: number; end: number } {
  const beforeCursor = sql.slice(0, cursor);
  const match = beforeCursor.match(/([A-Za-z_][\w.]*)$/);
  if (!match) return { value: "", start: cursor, end: cursor };
  return {
    value: match[1],
    start: cursor - match[1].length,
    end: cursor
  };
}

export function renderTemplate(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? `{{${name}}}`);
}

function getTableSuggestions(skill: DbSkill | null, token: string, database: string | null): Suggestion[] {
  if (!skill) return [];
  const needle = token.trim().toLowerCase();
  return filterTablesByDatabase(skill.tables, database)
    .map((table) => ({
      label: table.name,
      detail: [table.database, table.description || table.business].filter(Boolean).join(" · ") || "表",
      insertText: table.name
    }))
    .filter((item) => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle))
    .sort((a, b) => scoreTableSuggestion(a.label, needle) - scoreTableSuggestion(b.label, needle));
}

function inferSuggestionContext(sqlBeforeToken: string): "table" | "any" {
  const lower = stripQuotedSql(sqlBeforeToken).toLowerCase();
  const clausePattern = /\b(select|from|join|where|on|group\s+by|order\s+by|having|limit|update|into|delete\s+from|values|set)\b/g;
  const clauses = Array.from(lower.matchAll(clausePattern));
  const lastClause = clauses[clauses.length - 1]?.[1]?.replace(/\s+/g, " ");
  return lastClause && ["from", "join", "update", "into", "delete from"].includes(lastClause) ? "table" : "any";
}

function scoreTableSuggestion(label: string, needle: string): number {
  const normalized = label.toLowerCase();
  if (!needle) return 0;
  if (normalized === needle) return -10;
  if (normalized.startsWith(needle)) return -6;
  if (normalized.includes(needle)) return -3;
  return 0;
}

function stripQuotedSql(sql: string): string {
  return sql.replace(/'([^']|'')*'/g, " ").replace(/"([^"]|"")*"/g, " ").replace(/`[^`]*`/g, " ");
}

function splitDatabaseNames(value?: string): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
