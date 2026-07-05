export type SqlDialect =
  | "mysql"
  | "postgresql"
  | "hive"
  | "clickhouse"
  | "trino"
  | "sparksql"
  | "generic";

export type ModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dialect: SqlDialect;
  temperature: number;
};

export type DbColumn = {
  name: string;
  type?: string;
  description?: string;
};

export type DbTable = {
  database?: string;
  schema?: string;
  name: string;
  description?: string;
  business?: string;
  grain?: string;
  refresh?: string;
  owner?: string;
  relatedTables?: Array<{
    table: string;
    relation?: string;
    type?: string;
    description?: string;
  }>;
  columns?: DbColumn[];
  partitions?: string[];
};

export type DbMetric = {
  name: string;
  expression?: string;
  filters?: string;
  description?: string;
};

export type DbJoin = {
  left: string;
  right: string;
  type?: string;
  description?: string;
};

export type DbSkill = {
  id: string;
  name: string;
  dialect?: SqlDialect;
  raw: string;
  tables: DbTable[];
  metrics: DbMetric[];
  joins: DbJoin[];
  updatedAt: string;
};

export type SqlHistoryItem = {
  id: string;
  kind: "ask" | "complete" | "template" | "manual";
  title: string;
  prompt?: string;
  sql: string;
  skillId?: string;
  createdAt: string;
  favorite?: boolean;
};

export type TemplateVariableType =
  | "text"
  | "number"
  | "date"
  | "date_range"
  | "select"
  | "multi_select"
  | "table"
  | "column"
  | "metric"
  | "sql_fragment";

export type TemplateVariable = {
  name: string;
  label: string;
  type: TemplateVariableType;
  defaultValue?: string;
  options?: string[];
};

export type SqlTemplate = {
  id: string;
  name: string;
  description?: string;
  sql: string;
  variables: TemplateVariable[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type EditorContext = {
  detected: boolean;
  adapter: string;
  sql: string;
  selection: string;
  url: string;
  title: string;
  database?: string | null;
};

export type UrlScopeRule = {
  id: string;
  urlPattern: string;
  database: string;
  createdAt: string;
};

export type GenerateSqlRequest = {
  mode: "ask" | "complete";
  prompt: string;
  currentSql?: string;
  selection?: string;
  url?: string;
  database?: string | null;
  skill?: DbSkill | null;
  config: ModelConfig;
};

export type GenerateSqlResponse = {
  sql: string;
  explanation: string;
  raw: string;
};
