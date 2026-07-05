import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ClipboardList,
  Code2,
  Database,
  History,
  PanelRightOpen,
  Play,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Wand2
} from "lucide-react";
import type {
  DbSkill,
  EditorContext,
  GenerateSqlResponse,
  ModelConfig,
  SqlHistoryItem,
  SqlTemplate,
  TemplateVariable,
  TemplateVariableType,
  UrlScopeRule
} from "../types";
import { createId, getStore, saveHistory, saveModelConfig, saveSkills, saveTemplates, saveUrlScopeRules } from "../storage";
import { getSkillSuggestions, parseDbSkill } from "../skill";
import { createUrlPattern, inferDatabaseFromUrl } from "../scope";

type TabId = "ask" | "complete" | "history" | "templates" | "skill" | "settings";

type AppProps = {
  initialTab?: TabId;
};

const EMPTY_CONTEXT: EditorContext = {
  detected: false,
  adapter: "none",
  sql: "",
  selection: "",
  url: "",
  title: "",
  database: null
};

const VARIABLE_TYPES: TemplateVariableType[] = [
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

export function App({ initialTab = "ask" }: AppProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [config, setConfig] = useState<ModelConfig>({
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-chat",
    dialect: "hive",
    temperature: 0.1
  });
  const [skills, setSkills] = useState<DbSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [urlScopeRules, setUrlScopeRules] = useState<UrlScopeRule[]>([]);
  const [history, setHistory] = useState<SqlHistoryItem[]>([]);
  const [templates, setTemplates] = useState<SqlTemplate[]>([]);
  const [context, setContext] = useState<EditorContext>(EMPTY_CONTEXT);
  const [status, setStatus] = useState("");

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0] ?? null,
    [activeSkillId, skills]
  );

  useEffect(() => {
    getStore().then((store) => {
      setConfig(store.modelConfig);
      setSkills(store.skills);
      setActiveSkillId(store.activeSkillId);
      setUrlScopeRules(store.urlScopeRules);
      setHistory(store.history);
      setTemplates(store.templates);
      refreshEditorContext(store.urlScopeRules);
    });
  }, []);

  async function refreshEditorContext(scopeRules = urlScopeRules) {
    try {
      const result = await sendToActiveTab<EditorContext>({ type: "getEditorContext" });
      const database = result.database ?? inferDatabaseFromUrl(result.url, scopeRules);
      const nextContext = { ...result, database };
      setContext(nextContext);
      setStatus(
        nextContext.detected
          ? `已连接编辑器：${nextContext.adapter}${nextContext.database ? ` · DB: ${nextContext.database}` : ""}`
          : `未识别到 SQL 编辑器${nextContext.database ? ` · DB: ${nextContext.database}` : ""}，可手动复制使用`
      );
    } catch {
      const fallback = await getActiveTabContext(scopeRules);
      setContext(fallback);
      setStatus(
        fallback.url
          ? `当前页面未响应编辑器读取${fallback.database ? ` · 已识别 DB: ${fallback.database}` : ""}，刷新页面后可继续使用内联补全`
          : "当前页面未注入插件脚本，打开 DB 平台页面后再试"
      );
    }
  }

  async function insertSql(sql: string, mode: "insert" | "replace" | "set" = "insert") {
    const type = mode === "replace" ? "replaceSelection" : mode === "set" ? "setEditorSql" : "insertSql";
    await sendToActiveTab({ type, sql });
    setStatus(mode === "replace" ? "已替换选中 SQL" : "已插入 SQL");
    refreshEditorContext();
  }

  async function addHistory(item: Omit<SqlHistoryItem, "id" | "createdAt">) {
    const next = [
      {
        id: createId("history"),
        createdAt: new Date().toISOString(),
        ...item
      },
      ...history
    ].slice(0, 200);
    setHistory(next);
    await saveHistory(next);
  }

  async function updateHistory(next: SqlHistoryItem[]) {
    setHistory(next);
    await saveHistory(next);
  }

  async function updateTemplates(next: SqlTemplate[]) {
    setTemplates(next);
    await saveTemplates(next);
  }

  async function updateSkills(next: DbSkill[], nextActiveSkillId: string | null) {
    setSkills(next);
    setActiveSkillId(nextActiveSkillId);
    await saveSkills(next, nextActiveSkillId);
  }

  async function saveCurrentDatabase(database: string) {
    if (!context.url || !database.trim()) return;
    const pattern = createUrlPattern(context.url);
    const nextRule: UrlScopeRule = {
      id: createId("scope"),
      urlPattern: pattern,
      database: database.trim(),
      createdAt: new Date().toISOString()
    };
    const next = [nextRule, ...urlScopeRules.filter((rule) => rule.urlPattern !== pattern)];
    setUrlScopeRules(next);
    setContext({ ...context, database: database.trim() });
    await saveUrlScopeRules(next);
    setStatus(`已保存当前 URL scope：${database.trim()}`);
  }

  const tabs: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
    { id: "ask", label: "Ask", icon: <Bot size={16} /> },
    { id: "complete", label: "Complete", icon: <Wand2 size={16} /> },
    { id: "history", label: "History", icon: <History size={16} /> },
    { id: "templates", label: "Templates", icon: <ClipboardList size={16} /> },
    { id: "skill", label: "Skill", icon: <Database size={16} /> },
    { id: "settings", label: "Settings", icon: <Settings size={16} /> }
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">DB Skill Copilot</div>
          <div className="context-line">
            {activeSkill ? activeSkill.name : "未导入 DB Skill"} · {config.dialect}
          </div>
        </div>
        <button className="icon-button" title="刷新编辑器上下文" onClick={() => refreshEditorContext()}>
          <PanelRightOpen size={17} />
        </button>
      </header>

      <nav className="tabbar">
        {tabs.map((item) => (
          <button key={item.id} data-testid={`tab-${item.id}`} className={tab === item.id ? "tab active" : "tab"} onClick={() => setTab(item.id)} title={item.label}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        <ScopeBar context={context} onSaveDatabase={saveCurrentDatabase} />
        {tab === "ask" && (
          <AskTab
            config={config}
            context={context}
            activeSkill={activeSkill}
            onGenerated={(prompt, result) =>
              addHistory({ kind: "ask", title: prompt.slice(0, 80) || "对话生成 SQL", prompt, sql: result.sql, skillId: activeSkill?.id })
            }
            onInsert={insertSql}
          />
        )}
        {tab === "complete" && (
          <CompleteTab
            config={config}
            context={context}
            activeSkill={activeSkill}
            onRefreshContext={refreshEditorContext}
            onGenerated={(prompt, result) =>
              addHistory({ kind: "complete", title: prompt.slice(0, 80) || "SQL 补全", prompt, sql: result.sql, skillId: activeSkill?.id })
            }
            onInsert={insertSql}
          />
        )}
        {tab === "history" && <HistoryTab history={history} onUpdate={updateHistory} onInsert={insertSql} />}
        {tab === "templates" && (
          <TemplatesTab
            templates={templates}
            context={context}
            activeSkill={activeSkill}
            onRefreshContext={refreshEditorContext}
            onUpdate={updateTemplates}
            onInsert={async (sql) => {
              await addHistory({ kind: "template", title: "模板生成 SQL", sql, skillId: activeSkill?.id });
              await insertSql(sql);
            }}
          />
        )}
        {tab === "skill" && <SkillTab skills={skills} activeSkillId={activeSkillId} onUpdate={updateSkills} />}
        {tab === "settings" && <SettingsTab config={config} onSave={async (next) => {
          setConfig(next);
          await saveModelConfig(next);
          setStatus("设置已保存");
        }} />}
      </main>

      <footer className="statusbar">
        <span className={context.detected ? "dot ok" : "dot"} />
        <span>{status || "准备就绪"}</span>
      </footer>
    </div>
  );
}

function ScopeBar({ context, onSaveDatabase }: { context: EditorContext; onSaveDatabase: (database: string) => Promise<void> }) {
  const [database, setDatabase] = useState(context.database ?? "");

  useEffect(() => {
    setDatabase(context.database ?? "");
  }, [context.database, context.url]);

  return (
    <section className="scope-bar">
      <div>
        <div className="label">当前 DB</div>
        <div className="muted">{context.url ? context.url.replace(/^https?:\/\//, "").slice(0, 72) : "未连接页面"}</div>
      </div>
      <div className="scope-actions">
        <input
          data-testid="scope-database"
          className="input"
          value={database}
          onChange={(event) => setDatabase(event.target.value)}
          placeholder="识别不到时填 DB 名"
        />
        <button data-testid="scope-save" className="ghost-button" onClick={() => onSaveDatabase(database)} disabled={!database.trim() || !context.url}>
          <Save size={14} />
          保存
        </button>
      </div>
    </section>
  );
}

function AskTab({
  config,
  context,
  activeSkill,
  onGenerated,
  onInsert
}: {
  config: ModelConfig;
  context: EditorContext;
  activeSkill: DbSkill | null;
  onGenerated: (prompt: string, result: GenerateSqlResponse) => void;
  onInsert: (sql: string, mode?: "insert" | "replace" | "set") => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<GenerateSqlResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const next = await sendRuntime<GenerateSqlResponse>({
        type: "generateSql",
        payload: {
          mode: "ask",
          prompt,
          currentSql: context.sql,
          selection: context.selection,
          url: context.url,
          database: context.database,
          skill: activeSkill,
          config
        }
      });
      setResult(next);
      onGenerated(prompt, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <label className="label">用文字描述 SQL 需求</label>
      <textarea
        data-testid="ask-prompt"
        className="textarea prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="例如：查昨天各渠道 GMV，只统计支付成功订单，按 GMV 倒序"
      />
      <button data-testid="ask-generate" className="primary-button" onClick={generate} disabled={loading || !prompt.trim()}>
        <Sparkles size={16} />
        {loading ? "生成中..." : "生成 SQL"}
      </button>
      {error && <div className="notice danger">{error}</div>}
      <SqlResult result={result} onInsert={onInsert} />
    </section>
  );
}

function CompleteTab({
  config,
  context,
  activeSkill,
  onRefreshContext,
  onGenerated,
  onInsert
}: {
  config: ModelConfig;
  context: EditorContext;
  activeSkill: DbSkill | null;
  onRefreshContext: () => Promise<void>;
  onGenerated: (prompt: string, result: GenerateSqlResponse) => void;
  onInsert: (sql: string, mode?: "insert" | "replace" | "set") => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("补全这段 SQL");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GenerateSqlResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const suggestions = useMemo(() => getSkillSuggestions(activeSkill, query, context.database), [activeSkill, query, context.database]);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const next = await sendRuntime<GenerateSqlResponse>({
        type: "generateSql",
        payload: {
          mode: "complete",
          prompt: instruction,
          currentSql: context.sql,
          selection: context.selection,
          url: context.url,
          database: context.database,
          skill: activeSkill,
          config
        }
      });
      setResult(next);
      onGenerated(instruction, next);
      await onInsert(next.sql, context.selection ? "replace" : "set");
    } catch (err) {
      setError(err instanceof Error ? err.message : "补全失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <div className="row between">
        <div>
          <div className="label">当前编辑器</div>
          <div className="muted">{context.detected ? `${context.adapter} · ${context.sql.length} 字符` : "未识别到编辑器"}</div>
        </div>
        <button data-testid="complete-refresh" className="ghost-button" onClick={onRefreshContext}>
          <Search size={15} />
          读取
        </button>
      </div>
      <textarea data-testid="complete-current-sql" className="textarea compact" value={context.sql} readOnly placeholder="读取当前 DB 平台 SQL 编辑器内容" />

      <label className="label">补全要求</label>
      <input data-testid="complete-instruction" className="input" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      <button data-testid="complete-generate" className="primary-button" onClick={generate} disabled={loading}>
        <Wand2 size={16} />
        {loading ? "补全中..." : "智能补全"}
      </button>
      {error && <div className="notice danger">{error}</div>}
      <SqlResult result={result} onInsert={onInsert} />

      <div className="divider" />
      <label className="label">本地表字段补全</label>
      <input data-testid="suggestion-query" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索表、字段、指标" />
      <div className="suggestion-list">
        {suggestions.map((item) => (
          <button key={`${item.label}-${item.detail}`} className="suggestion" onClick={() => onInsert(item.insertText)}>
            <Code2 size={15} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SqlResult({
  result,
  onInsert
}: {
  result: GenerateSqlResponse | null;
  onInsert: (sql: string, mode?: "insert" | "replace" | "set") => Promise<void>;
}) {
  if (!result) return null;
  return (
    <div className="result">
      <div className="row between">
        <div className="label">生成结果</div>
        <div className="button-group">
          <button className="ghost-button" onClick={() => onInsert(result.sql)}>
            <Plus size={14} />
            插入
          </button>
          <button className="ghost-button" onClick={() => onInsert(result.sql, "replace")}>
            <Check size={14} />
            替换
          </button>
        </div>
      </div>
      <pre data-testid="sql-result" className="code-block">{result.sql}</pre>
      {result.explanation && <div className="notice">{result.explanation}</div>}
    </div>
  );
}

function HistoryTab({
  history,
  onUpdate,
  onInsert
}: {
  history: SqlHistoryItem[];
  onUpdate: (history: SqlHistoryItem[]) => Promise<void>;
  onInsert: (sql: string, mode?: "insert" | "replace" | "set") => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const filtered = history.filter((item) => `${item.title} ${item.prompt ?? ""} ${item.sql}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="panel">
      <div className="searchbox">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索历史 SQL" />
      </div>
      <div className="item-list">
        {filtered.map((item) => (
          <article key={item.id} className="item-card">
            <div className="row between">
              <div>
                <h3>{item.title}</h3>
                <p>{new Date(item.createdAt).toLocaleString()} · {item.kind}</p>
              </div>
              <button
                className="icon-button"
                title="收藏"
                onClick={() =>
                  onUpdate(history.map((current) => (current.id === item.id ? { ...current, favorite: !current.favorite } : current)))
                }
              >
                <Star size={16} fill={item.favorite ? "currentColor" : "none"} />
              </button>
            </div>
            <pre className="code-block small">{item.sql}</pre>
            <div className="row">
              <button className="ghost-button" onClick={() => onInsert(item.sql)}>
                <Plus size={14} />
                插入
              </button>
              <button className="ghost-button" onClick={() => onInsert(item.sql, "replace")}>
                <Check size={14} />
                替换
              </button>
              <button className="ghost-button danger-text" onClick={() => onUpdate(history.filter((current) => current.id !== item.id))}>
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </article>
        ))}
        {!filtered.length && <div className="empty">还没有历史记录</div>}
      </div>
    </section>
  );
}

function TemplatesTab({
  templates,
  context,
  activeSkill,
  onRefreshContext,
  onUpdate,
  onInsert
}: {
  templates: SqlTemplate[];
  context: EditorContext;
  activeSkill: DbSkill | null;
  onRefreshContext: () => Promise<void>;
  onUpdate: (templates: SqlTemplate[]) => Promise<void>;
  onInsert: (sql: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [draftSql, setDraftSql] = useState("");
  const [fragment, setFragment] = useState("");
  const [variableName, setVariableName] = useState("");
  const [variableType, setVariableType] = useState<TemplateVariableType>("text");
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  const renderedSql = selectedTemplate ? renderTemplate(selectedTemplate.sql, values) : "";

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) setSelectedTemplateId(templates[0].id);
  }, [selectedTemplateId, templates]);

  function loadFromEditor() {
    setDraftSql(context.selection || context.sql);
    if (!context.sql) onRefreshContext();
  }

  function addVariable() {
    if (!fragment.trim() || !variableName.trim()) return;
    const safeName = variableName.trim().replace(/[^\w]/g, "_");
    setDraftSql((sql) => sql.split(fragment).join(`{{${safeName}}}`));
    setVariables((current) => [
      ...current.filter((item) => item.name !== safeName),
      { name: safeName, label: safeName, type: variableType, defaultValue: fragment }
    ]);
    setFragment("");
    setVariableName("");
  }

  async function saveTemplate() {
    if (!name.trim() || !draftSql.trim()) return;
    const now = new Date().toISOString();
    const next: SqlTemplate = {
      id: createId("template"),
      name: name.trim(),
      sql: draftSql,
      variables,
      tags: activeSkill ? [activeSkill.name] : [],
      createdAt: now,
      updatedAt: now
    };
    await onUpdate([next, ...templates]);
    setSelectedTemplateId(next.id);
    setName("");
    setDraftSql("");
    setVariables([]);
  }

  return (
    <section className="panel split">
      <div className="subpanel">
        <div className="row between">
          <h2>创建模板</h2>
          <button className="ghost-button" onClick={loadFromEditor}>
            <BookOpen size={15} />
            载入 SQL
          </button>
        </div>
        <input data-testid="template-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="模板名称，例如：渠道 GMV 日报" />
        <textarea data-testid="template-sql" className="textarea template-sql" value={draftSql} onChange={(event) => setDraftSql(event.target.value)} placeholder="粘贴 SQL，或从当前编辑器载入" />
        <div className="variable-grid">
          <input data-testid="template-fragment" className="input" value={fragment} onChange={(event) => setFragment(event.target.value)} placeholder="要替换的片段" />
          <input data-testid="template-variable-name" className="input" value={variableName} onChange={(event) => setVariableName(event.target.value)} placeholder="变量名" />
          <select data-testid="template-variable-type" className="input" value={variableType} onChange={(event) => setVariableType(event.target.value as TemplateVariableType)}>
            {VARIABLE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button data-testid="template-add-variable" className="ghost-button" onClick={addVariable}>
            <Plus size={14} />
            变量
          </button>
        </div>
        <div className="chips">
          {variables.map((variable) => (
            <span key={variable.name} className="chip">{variable.name} · {variable.type}</span>
          ))}
        </div>
        <button data-testid="template-save" className="primary-button" onClick={saveTemplate} disabled={!name.trim() || !draftSql.trim()}>
          <Save size={16} />
          保存模板
        </button>
      </div>

      <div className="subpanel">
        <h2>使用模板</h2>
        <select data-testid="template-select" className="input" value={selectedTemplate?.id ?? ""} onChange={(event) => setSelectedTemplateId(event.target.value)}>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
        {selectedTemplate ? (
          <>
            <div className="form-grid">
              {selectedTemplate.variables.map((variable) => (
                <label key={variable.name} className="field">
                  <span>{variable.label}</span>
                  <input
                    className="input"
                    value={values[variable.name] ?? variable.defaultValue ?? ""}
                    onChange={(event) => setValues({ ...values, [variable.name]: event.target.value })}
                    placeholder={variable.type}
                  />
                </label>
              ))}
            </div>
            <pre className="code-block">{renderedSql}</pre>
            <div className="row">
              <button className="primary-button" onClick={() => onInsert(renderedSql)}>
                <Play size={15} />
                生成并插入
              </button>
              <button className="ghost-button danger-text" onClick={() => onUpdate(templates.filter((template) => template.id !== selectedTemplate.id))}>
                <Trash2 size={14} />
                删除模板
              </button>
            </div>
          </>
        ) : (
          <div className="empty">还没有模板</div>
        )}
      </div>
    </section>
  );
}

function SkillTab({
  skills,
  activeSkillId,
  onUpdate
}: {
  skills: DbSkill[];
  activeSkillId: string | null;
  onUpdate: (skills: DbSkill[], activeSkillId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  async function importSkill() {
    setError("");
    try {
      const skill = parseDbSkill(raw, name || "DB Skill");
      if (name.trim()) skill.name = name.trim();
      await onUpdate([skill, ...skills], skill.id);
      setName("");
      setRaw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    }
  }

  return (
    <section className="panel">
      <label className="label">Skill 名称</label>
      <input data-testid="skill-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：交易数仓" />
      <label className="label">DB Skill Markdown / JSON</label>
      <textarea data-testid="skill-raw" className="textarea skill-input" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="# DB Skill: user_analytics..." />
      <button data-testid="skill-import" className="primary-button" onClick={importSkill} disabled={!raw.trim()}>
        <Database size={16} />
        导入 Skill
      </button>
      {error && <div className="notice danger">{error}</div>}

      <div className="item-list">
        {skills.map((skill) => (
          <article key={skill.id} className={skill.id === activeSkillId ? "item-card selected" : "item-card"}>
            <div className="row between">
              <div>
                <h3>{skill.name}</h3>
                <p>{skill.tables.length} tables · {skill.metrics.length} metrics · {new Date(skill.updatedAt).toLocaleString()}</p>
              </div>
              <div className="row">
                <button className="ghost-button" onClick={() => onUpdate(skills, skill.id)}>
                  <Check size={14} />
                  使用
                </button>
                <button className="icon-button" title="删除" onClick={() => onUpdate(skills.filter((item) => item.id !== skill.id), activeSkillId === skill.id ? null : activeSkillId)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsTab({ config, onSave }: { config: ModelConfig; onSave: (config: ModelConfig) => Promise<void> }) {
  const [draft, setDraft] = useState(config);
  useEffect(() => setDraft(config), [config]);

  return (
    <section className="panel">
      <label className="field">
        <span>Base URL</span>
        <input data-testid="setting-base-url" className="input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.deepseek.com" />
      </label>
      <label className="field">
        <span>API Key</span>
        <input data-testid="setting-api-key" className="input" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="sk-..." />
      </label>
      <label className="field">
        <span>Model</span>
        <input data-testid="setting-model" className="input" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="deepseek-chat" />
      </label>
      <label className="field">
        <span>SQL Dialect</span>
        <select data-testid="setting-dialect" className="input" value={draft.dialect} onChange={(event) => setDraft({ ...draft, dialect: event.target.value as ModelConfig["dialect"] })}>
          <option value="hive">Hive</option>
          <option value="mysql">MySQL</option>
          <option value="postgresql">PostgreSQL</option>
          <option value="clickhouse">ClickHouse</option>
          <option value="trino">Trino</option>
          <option value="sparksql">SparkSQL</option>
          <option value="generic">Generic</option>
        </select>
      </label>
      <label className="field">
        <span>Temperature</span>
        <input
          data-testid="setting-temperature"
          className="input"
          type="number"
          min="0"
          max="1"
          step="0.1"
          value={draft.temperature}
          onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
        />
      </label>
      <button data-testid="setting-save" className="primary-button" onClick={() => onSave(draft)}>
        <Save size={16} />
        保存设置
      </button>
    </section>
  );
}

function renderTemplate(sql: string, values: Record<string, string>) {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? `{{${name}}}`);
}

async function sendRuntime<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? "请求失败"));
        return;
      }
      resolve(response.result as T);
    });
  });
}

async function sendToActiveTab<T = unknown>(message: unknown): Promise<T> {
  const tab = await getActiveHttpTab();
  if (!tab?.id) throw new Error("没有活动标签页");
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id!, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? "页面操作失败"));
        return;
      }
      resolve((response.result ?? response) as T);
    });
  });
}

async function getActiveTabContext(urlScopeRules: UrlScopeRule[]): Promise<EditorContext> {
  const tab = await getActiveHttpTab();
  const url = tab?.url ?? "";
  return {
    ...EMPTY_CONTEXT,
    url,
    title: tab?.title ?? "",
    database: url ? inferDatabaseFromUrl(url, urlScopeRules) : null
  };
}

async function getActiveHttpTab(): Promise<chrome.tabs.Tab | null> {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = activeTabs.find((tab) => tab.url?.startsWith("http"));
  if (activeTab) return activeTab;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.find((tab) => tab.active && tab.url?.startsWith("http")) ?? tabs.find((tab) => tab.url?.startsWith("http")) ?? null;
}
