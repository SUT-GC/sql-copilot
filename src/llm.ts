import type { GenerateSqlRequest, GenerateSqlResponse } from "./types";
import { retrieveRelevantSkill, skillToPrompt } from "./skill";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function generateSql(request: GenerateSqlRequest): Promise<GenerateSqlResponse> {
  const { config } = request;
  if (!config.apiKey.trim()) {
    throw new Error("请先在 Settings 配置 API Key");
  }

  const endpoint = normalizeEndpoint(config.baseUrl);
  const system = [
    "你是一个严谨的 SQL Copilot，帮助用户在 DB 管理平台中写 SQL。",
    "你必须优先使用用户提供的 DB Skill，不要编造不存在的表或字段。",
    "默认只生成 SELECT 查询。除非用户明确要求，不要生成 INSERT、UPDATE、DELETE、DROP、ALTER。",
    "如果缺少必要信息，先说明缺失信息，并给出可执行的最小 SQL 或需要用户补充的问题。",
    `SQL 方言：${config.dialect}`,
    "输出格式必须是：先给一个 ```sql 代码块，然后用 3 条以内中文解释说明表、字段、过滤和 join。"
  ].join("\n");

  const user = buildUserPrompt(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `模型请求失败：${response.status}`);
  }

  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("模型没有返回内容");
  return splitSqlResponse(raw);
}

function buildUserPrompt(request: GenerateSqlRequest): string {
  const retrieval = retrieveRelevantSkill(request.skill, {
    prompt: request.prompt,
    currentSql: request.currentSql,
    selection: request.selection
  });
  const skill = skillToPrompt(retrieval.skill, retrieval.reason);
  if (request.mode === "complete") {
    return [
      "请根据当前 SQL 上下文做续写/补全。",
      "如果用户有额外要求，按要求修改或续写。",
      "",
      "## DB Skill",
      skill,
      "",
      "## 当前 SQL",
      request.currentSql || "(空)",
      "",
      "## 当前选中内容",
      request.selection || "(无)",
      "",
      "## 用户补全要求",
      request.prompt || "补全这段 SQL"
    ].join("\n");
  }

  return [
    "请根据用户自然语言需求生成 SQL。",
    "",
    "## DB Skill",
    skill,
    "",
    "## 当前 SQL",
    request.currentSql || "(空)",
    "",
    "## 用户需求",
    request.prompt
  ].join("\n");
}

function normalizeEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function splitSqlResponse(raw: string): GenerateSqlResponse {
  const block = raw.match(/```sql\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/);
  const sql = (block?.[1] ?? raw).trim();
  const explanation = block ? raw.replace(block[0], "").trim() : "";
  return { sql, explanation, raw };
}
