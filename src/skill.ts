import type { DbColumn, DbJoin, DbMetric, DbSkill, DbTable, SqlDialect } from "./types";
import { createId } from "./storage";

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
  const parsed = JSON.parse(input) as Partial<DbSkill> & {
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

export function skillToPrompt(skill: DbSkill | null | undefined): string {
  if (!skill) return "未提供 DB Skill。缺少表字段信息时必须向用户说明，不要编造字段。";
  const tables = skill.tables
    .map((table) => {
      const columns = (table.columns ?? [])
        .map((column) => `  - ${column.name}${column.type ? ` (${column.type})` : ""}: ${column.description ?? ""}`)
        .join("\n");
      return `### ${table.name}\n${table.description ?? ""}\n${columns}`;
    })
    .join("\n\n");
  const metrics = skill.metrics
    .map((metric) => `- ${metric.name}: ${metric.expression ?? ""} ${metric.filters ? `过滤：${metric.filters}` : ""} ${metric.description ?? ""}`)
    .join("\n");
  const joins = skill.joins.map((join) => `- ${join.left} = ${join.right} ${join.description ?? ""}`).join("\n");

  return [
    `DB Skill 名称：${skill.name}`,
    "## Tables",
    tables || "无",
    "## Metrics",
    metrics || "无",
    "## Joins",
    joins || "无",
    "## Raw Notes",
    skill.raw.slice(0, 12000)
  ].join("\n");
}

export function getSkillSuggestions(skill: DbSkill | null, query: string): Array<{ label: string; detail: string; insertText: string }> {
  if (!skill) return [];
  const needle = query.trim().toLowerCase();
  const suggestions: Array<{ label: string; detail: string; insertText: string }> = [];

  for (const table of skill.tables) {
    suggestions.push({
      label: table.name,
      detail: table.description ? `表 · ${table.description}` : "表",
      insertText: table.name
    });
    for (const column of table.columns ?? []) {
      suggestions.push({
        label: column.name,
        detail: `${table.name}${column.type ? ` · ${column.type}` : ""}${column.description ? ` · ${column.description}` : ""}`,
        insertText: column.name
      });
    }
  }

  for (const metric of skill.metrics) {
    suggestions.push({
      label: metric.name,
      detail: `指标 · ${metric.expression ?? metric.description ?? ""}`,
      insertText: metric.expression ?? metric.name
    });
  }

  return suggestions
    .filter((item) => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle))
    .slice(0, 40);
}
