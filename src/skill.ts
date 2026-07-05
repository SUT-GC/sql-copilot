import type { DbColumn, DbJoin, DbMetric, DbSkill, DbTable, SqlDialect } from "./types";
import { createId } from "./storage";

const MAX_RETRIEVED_TABLES = 20;
const MAX_RETRIEVED_METRICS = 20;

export function parseDbSkill(input: string, fallbackName = "DB Skill"): DbSkill {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("DB Skill 内容不能为空");
  }

  if (trimmed.startsWith("{")) {
    return parseJsonSkill(trimmed, fallbackName);
  }

  return parseMarkdownSkill(trimmed, fallbackName);
}

function parseJsonSkill(input: string, fallbackName: string): DbSkill {
  const parsed = parseJsonObject(input) as Partial<DbSkill> & {
    dialect?: SqlDialect;
    tables?: DbTable[];
    metrics?: DbMetric[];
    joins?: DbJoin[];
  };

  return {
    id: createId("skill"),
    name: parsed.name ?? fallbackName,
    dialect: parsed.dialect,
    raw: input,
    tables: parsed.tables ?? [],
    metrics: parsed.metrics ?? [],
    joins: parsed.joins ?? [],
    updatedAt: new Date().toISOString()
  };
}

function parseJsonObject(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const lastBrace = input.lastIndexOf("}");
    if (lastBrace > 0) {
      return JSON.parse(input.slice(0, lastBrace + 1));
    }
    throw error;
  }
}

function parseMarkdownSkill(input: string, fallbackName: string): DbSkill {
  const title = input.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallbackName;
  const tables: DbTable[] = [];
  const metrics: DbMetric[] = [];
  const joins: DbJoin[] = [];
  const lines = input.split(/\r?\n/);
  let currentTable: DbTable | null = null;
  let section = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      currentTable = null;
      continue;
    }

    const tableMatch = line.match(/^###\s+([`.\w-]+)(?:\s*[-:：]\s*(.+))?$/);
    if (tableMatch && section.includes("table")) {
      currentTable = {
        name: stripTicks(tableMatch[1]),
        description: tableMatch[2],
        columns: []
      };
      tables.push(currentTable);
      continue;
    }

    if (currentTable && line.startsWith("-")) {
      const column = parseColumnLine(line);
      if (column) {
        currentTable.columns = currentTable.columns ?? [];
        currentTable.columns.push(column);
      }
      continue;
    }

    if (section.includes("metric") && line.startsWith("-")) {
      metrics.push(parseMetricLine(line));
      continue;
    }

    if ((section.includes("relationship") || section.includes("join")) && line.startsWith("-")) {
      const join = parseJoinLine(line);
      if (join) joins.push(join);
    }
  }

  return {
    id: createId("skill"),
    name: title.replace(/^DB Skill:\s*/i, ""),
    raw: input,
    tables,
    metrics,
    joins,
    updatedAt: new Date().toISOString()
  };
}

function parseColumnLine(line: string): DbColumn | null {
  const body = line.replace(/^-\s*/, "");
  const match = body.match(/^([`.\w-]+)(?:\s*\(([^)]+)\))?\s*[:：-]\s*(.+)$/);
  if (!match) return null;
  return {
    name: stripTicks(match[1]),
    type: match[2],
    description: match[3]
  };
}

function parseMetricLine(line: string): DbMetric {
  const body = line.replace(/^-\s*/, "");
  const [namePart, ...rest] = body.split(/[:：]/);
  return {
    name: stripTicks(namePart.trim()),
    description: rest.join(":").trim() || body
  };
}

function parseJoinLine(line: string): DbJoin | null {
  const body = line.replace(/^-\s*/, "");
  const match = body.match(/([`.\w-]+)\s*=\s*([`.\w-]+)/);
  if (!match) return null;
  return {
    left: stripTicks(match[1]),
    right: stripTicks(match[2]),
    type: "join",
    description: body
  };
}

function stripTicks(value: string): string {
  return value.replace(/^`|`$/g, "").trim();
}

export function retrieveRelevantSkill(
  skill: DbSkill | null | undefined,
  input: { prompt?: string; currentSql?: string; selection?: string; database?: string | null }
): { skill: DbSkill | null; reason: string } {
  if (!skill) return { skill: null, reason: "未提供 DB Skill" };
  const scopedTables = filterTablesByDatabase(skill.tables, input.database ?? null);
  const scopedSkill = { ...skill, tables: scopedTables };
  const databaseReason = input.database ? `当前页面 DB：${input.database}，已先过滤到该 DB 范围。` : "";

  const explicitTableNames = extractExplicitTables(input.currentSql ?? "", scopedSkill);
  if (explicitTableNames.size > 0) {
    const tables = scopedSkill.tables.filter((table) => explicitTableNames.has(normalizeName(table.name)));
    return {
      skill: cloneSkillSubset(skill, tables, filterJoins(skill.joins, tables, "both"), filterMetrics(skill.metrics, tables, input)),
      reason: `${databaseReason}当前 SQL 已显式输入表：${tables.map((table) => table.name).join(", ")}，仅使用这些表做上下文。`
    };
  }

  const searchText = [input.prompt, input.currentSql, input.selection].filter(Boolean).join("\n");
  const scoredTables = scopedSkill.tables
    .map((table) => ({ table, score: scoreTable(table, searchText) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETRIEVED_TABLES)
    .map((item) => item.table);

  const tables = scoredTables.length ? scoredTables : scopedSkill.tables.slice(0, Math.min(scopedSkill.tables.length, 8));
  return {
    skill: cloneSkillSubset(skill, tables, filterJoins(skill.joins, tables, "any"), filterMetrics(skill.metrics, tables, input)),
    reason: scoredTables.length
      ? `${databaseReason}按用户输入检索出相关表：${tables.map((table) => table.name).join(", ")}。`
      : `${databaseReason}没有明显表匹配，使用前 ${tables.length} 张表作为候选上下文。`
  };
}

export function skillToPrompt(skill: DbSkill | null | undefined, retrievalReason?: string): string {
  if (!skill) return "未提供 DB Skill。缺少表字段信息时必须向用户说明，不要编造字段。";
  const tables = skill.tables
    .map((table) => {
      const relatedTables = (table.relatedTables ?? [])
        .map((related) => `  - ${related.table}${related.relation ? `: ${related.relation}` : ""}${related.description ? `，${related.description}` : ""}`)
        .join("\n");
      const columns = (table.columns ?? [])
        .map((column) => `  - ${column.name}${column.type ? ` (${column.type})` : ""}: ${column.description ?? ""}`)
        .join("\n");
      return [
        `### ${formatTableName(table)}`,
        table.description ?? "",
        table.business ? `业务含义：${table.business}` : "",
        table.grain ? `数据粒度：${table.grain}` : "",
        table.refresh ? `刷新频率：${table.refresh}` : "",
        table.owner ? `负责人：${table.owner}` : "",
        relatedTables ? `关联表：\n${relatedTables}` : "",
        columns
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const metrics = skill.metrics
    .map((metric) => `- ${metric.name}: ${metric.expression ?? ""} ${metric.filters ? `过滤：${metric.filters}` : ""} ${metric.description ?? ""}`)
    .join("\n");
  const joins = skill.joins.map((join) => `- ${join.left} = ${join.right} ${join.description ?? ""}`).join("\n");

  return [
    `DB Skill 名称：${skill.name}`,
    retrievalReason ? `检索说明：${retrievalReason}` : "",
    "## Tables",
    tables || "无",
    "## Metrics",
    metrics || "无",
    "## Joins",
    joins || "无"
  ]
    .filter(Boolean)
    .join("\n");
}

export function getSkillSuggestions(skill: DbSkill | null, query: string, database?: string | null): Array<{ label: string; detail: string; insertText: string }> {
  if (!skill) return [];
  const needle = query.trim().toLowerCase();
  const suggestions: Array<{ label: string; detail: string; insertText: string; kind: "table" | "column" | "metric" }> = [];

  for (const table of filterTablesByDatabase(skill.tables, database ?? null)) {
    suggestions.push({
      label: table.name,
      detail: [table.database, table.description].filter(Boolean).join(" · ") || "表",
      insertText: table.name,
      kind: "table"
    });
    for (const column of table.columns ?? []) {
      suggestions.push({
        label: column.name,
        detail: `${table.name}${column.type ? ` · ${column.type}` : ""}${column.description ? ` · ${column.description}` : ""}`,
        insertText: column.name,
        kind: "column"
      });
    }
  }

  for (const metric of skill.metrics) {
    suggestions.push({
      label: metric.name,
      detail: `指标 · ${metric.expression ?? metric.description ?? ""}`,
      insertText: metric.expression ?? metric.name,
      kind: "metric"
    });
  }

  return suggestions
    .filter((item) => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle))
    .sort((a, b) => scoreSuggestion(a, needle) - scoreSuggestion(b, needle))
    .map(({ kind: _kind, ...item }) => item)
    .slice(0, 40);
}

function scoreSuggestion(item: { label: string; kind: "table" | "column" | "metric" }, needle: string): number {
  const label = item.label.toLowerCase();
  let score = item.kind === "table" ? 0 : item.kind === "metric" ? 10 : 20;
  if (!needle) return score;
  if (label === needle) score -= 10;
  else if (label.startsWith(needle)) score -= 6;
  else if (label.includes(needle)) score -= 3;
  return score;
}

export function filterTablesByDatabase(tables: DbTable[], database: string | null): DbTable[] {
  if (!database) return tables;
  const normalized = normalizeName(database);
  return tables.filter((table) => !table.database || splitDatabaseNames(table.database).includes(normalized));
}

function extractExplicitTables(sql: string, skill: DbSkill): Set<string> {
  const result = new Set<string>();
  if (!sql.trim()) return result;
  const normalizedTableNames = new Map(skill.tables.map((table) => [normalizeName(table.name), table.name]));
  const escapedNames = Array.from(normalizedTableNames.keys()).sort((a, b) => b.length - a.length).map(escapeRegExp);

  const relationPattern = /\b(?:from|join|update|into)\s+([`"[]?[\w.-]+[`"\]]?)/gi;
  for (const match of sql.matchAll(relationPattern)) {
    const tableName = normalizeName(match[1]);
    const direct = normalizedTableNames.get(tableName);
    if (direct) result.add(normalizeName(direct));
    const shortName = tableName.split(".").pop() ?? tableName;
    const shortMatch = skill.tables.find((table) => normalizeName(table.name).split(".").pop() === shortName);
    if (shortMatch) result.add(normalizeName(shortMatch.name));
  }

  if (result.size === 0 && escapedNames.length) {
    const namePattern = new RegExp(`\\b(${escapedNames.join("|")})\\b`, "gi");
    for (const match of sql.matchAll(namePattern)) {
      result.add(normalizeName(match[1]));
    }
  }

  return result;
}

function cloneSkillSubset(skill: DbSkill, tables: DbTable[], joins: DbJoin[], metrics: DbMetric[]): DbSkill {
  return {
    ...skill,
    raw: "",
    tables,
    joins,
    metrics
  };
}

function filterJoins(joins: DbJoin[], tables: DbTable[], mode: "any" | "both"): DbJoin[] {
  const tableNames = new Set(tables.map((table) => normalizeName(table.name)));
  return joins.filter((join) => {
    const left = normalizeName(join.left).split(".").slice(0, -1).join(".");
    const right = normalizeName(join.right).split(".").slice(0, -1).join(".");
    const leftMatches = tableNames.has(left) || tableNames.has(left.split(".").pop() ?? left);
    const rightMatches = tableNames.has(right) || tableNames.has(right.split(".").pop() ?? right);
    return mode === "both" ? leftMatches && rightMatches : leftMatches || rightMatches;
  });
}

function filterMetrics(metrics: DbMetric[], tables: DbTable[], input: { prompt?: string; currentSql?: string; selection?: string }): DbMetric[] {
  const searchText = [input.prompt, input.currentSql, input.selection].filter(Boolean).join(" ").toLowerCase();
  const tableTerms = new Set<string>();
  for (const table of tables) {
    tableTerms.add(normalizeName(table.name));
    for (const column of table.columns ?? []) {
      tableTerms.add(normalizeName(column.name));
    }
  }

  return metrics
    .map((metric) => ({ metric, score: scoreMetric(metric, searchText, tableTerms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETRIEVED_METRICS)
    .map((item) => item.metric);
}

function scoreTable(table: DbTable, searchText: string): number {
  const lowerSearchText = searchText.toLowerCase();
  const haystack = [
    table.name,
    table.database,
    table.schema,
    table.description,
    table.business,
    table.grain,
    ...(table.columns ?? []).flatMap((column) => [column.name, column.type, column.description])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tokens = tokenize(searchText);
  let score = 0;
  if (lowerSearchText.includes(normalizeName(table.name))) score += 12;
  if (table.description && lowerSearchText.includes(table.description.toLowerCase())) score += 6;
  for (const column of table.columns ?? []) {
    if (lowerSearchText.includes(normalizeName(column.name))) score += 10;
    if (column.description && lowerSearchText.includes(column.description.toLowerCase())) score += 6;
  }
  for (const token of tokens) {
    if (normalizeName(table.name).includes(token)) score += 8;
    if (haystack.includes(token)) score += 2;
    for (const column of table.columns ?? []) {
      if (normalizeName(column.name).includes(token)) score += 4;
    }
  }
  return score;
}

function formatTableName(table: DbTable): string {
  return [table.database, table.schema, table.name].filter(Boolean).join(".");
}

function scoreMetric(metric: DbMetric, searchText: string, tableTerms: Set<string>): number {
  const lowerSearchText = searchText.toLowerCase();
  const haystack = [metric.name, metric.expression, metric.filters, metric.description].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (lowerSearchText.includes(normalizeName(metric.name))) score += 8;
  if (metric.description && lowerSearchText.includes(metric.description.toLowerCase())) score += 4;
  for (const token of tokenize(searchText)) {
    if (normalizeName(metric.name).includes(token)) score += 6;
    if (haystack.includes(token)) score += 2;
  }
  for (const term of tableTerms) {
    if (term && haystack.includes(term)) score += 1;
  }
  return score;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().match(/[\p{L}\p{N}_$.]+/gu) ?? []))
    .map(normalizeName)
    .filter((token) => token.length >= 2 && !SQL_STOP_WORDS.has(token));
}

function normalizeName(value: string): string {
  return value.replace(/^[`"[]|[`"\]]$/g, "").toLowerCase().trim();
}

function splitDatabaseNames(value: string): string[] {
  return value.split(",").map(normalizeName).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SQL_STOP_WORDS = new Set([
  "select",
  "from",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "group",
  "order",
  "by",
  "and",
  "or",
  "as",
  "on",
  "limit",
  "count",
  "sum",
  "avg",
  "max",
  "min"
]);
