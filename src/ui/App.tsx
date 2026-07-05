import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Bot,
  Check,
  ClipboardList,
  Code2,
  Copy,
  Database,
  History,
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
  GenerateSqlResponse,
  ModelConfig,
  SqlHistoryItem,
  SqlTemplate,
  TemplateVariable,
  TemplateVariableType
} from "../types";
import { createId, getStore, saveHistory, saveModelConfig, saveSkills, saveTemplates } from "../storage";
import { filterTablesByDatabase, parseDbSkill } from "../skill";
import {
  getCurrentToken,
  getDatabaseOptions,
  getWorkspaceSuggestions,
  renderTemplate,
  VARIABLE_TYPES
} from "./workspace";
import type { Suggestion, WorkspaceState } from "./workspace";

type TabId = "write" | "ask" | "history" | "templates" | "skill" | "settings";

type AppProps = {
  initialTab?: TabId;
};

export function App({ initialTab = "write" }: AppProps) {
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
  const [history, setHistory] = useState<SqlHistoryItem[]>([]);
  const [templates, setTemplates] = useState<SqlTemplate[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ sql: "", database: null });
  const [status, setStatus] = useState("");

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0] ?? null,
    [activeSkillId, skills]
  );
  const databases = useMemo(() => getDatabaseOptions(activeSkill), [activeSkill]);
  const scopedTables = useMemo(
    () => filterTablesByDatabase(activeSkill?.tables ?? [], workspace.database),
    [activeSkill, workspace.database]
  );

  useEffect(() => {
    getStore().then((store) => {
      setConfig(store.modelConfig);
      setSkills(store.skills);
      setActiveSkillId(store.activeSkillId);
      setHistory(store.history);
      setTemplates(store.templates);
      setStatus("本地 SQL 工作台已就绪");
    });
  }, []);

  useEffect(() => {
    if (workspace.database && !databases.includes(workspace.database)) {
      setWorkspace((current) => ({ ...current, database: databases[0] ?? null }));
    }
  }, [databases, workspace.database]);

  async function copySql(sql: string, label = "SQL") {
    await navigator.clipboard.writeText(sql);
    setStatus(`已复制${label}`);
  }

  function useSql(sql: string, source = "SQL") {
    setWorkspace((current) => ({ ...current, sql }));
    setTab("write");
    setStatus(`已放入工作台：${source}`);
  }

  function updateWorkspaceSql(sql: string) {
    setWorkspace((current) => ({ ...current, sql }));
  }

  function updateWorkspaceDatabase(database: string | null) {
    setWorkspace((current) => ({ ...current, database }));
    setStatus(database ? `已切换 DB：${database}` : "已切换到全部 DB");
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

  const tabs: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
    { id: "write", label: "Write", icon: <Code2 size={16} /> },
    { id: "ask", label: "Ask", icon: <Bot size={16} /> },
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
        <button className="icon-button" title="复制工作台 SQL" onClick={() => copySql(workspace.sql)} disabled={!workspace.sql.trim()}>
          <Copy size={17} />
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
        <WorkspaceScope
          activeSkill={activeSkill}
          databases={databases}
          selectedDatabase={workspace.database}
          scopedTableCount={scopedTables.length}
          onDatabaseChange={updateWorkspaceDatabase}
        />
        {tab === "write" && (
          <WriteTab
            config={config}
            workspace={workspace}
            activeSkill={activeSkill}
            onSqlChange={updateWorkspaceSql}
            onGenerated={async (instruction, result) => {
              updateWorkspaceSql(result.sql);
              await addHistory({ kind: "complete", title: instruction.slice(0, 80) || "SQL 补全", prompt: instruction, sql: result.sql, skillId: activeSkill?.id });
              setStatus("已在工作台生成补全 SQL");
            }}
            onCopy={copySql}
          />
        )}
        {tab === "ask" && (
          <AskTab
            config={config}
            workspace={workspace}
            activeSkill={activeSkill}
            onGenerated={async (prompt, result) => {
              updateWorkspaceSql(result.sql);
              await addHistory({ kind: "ask", title: prompt.slice(0, 80) || "对话生成 SQL", prompt, sql: result.sql, skillId: activeSkill?.id });
              setStatus("已生成并放入工作台");
            }}
            onCopy={copySql}
          />
        )}
        {tab === "history" && <HistoryTab history={history} onUpdate={updateHistory} onCopy={copySql} onUse={useSql} />}
        {tab === "templates" && (
          <TemplatesTab
            templates={templates}
            workspace={workspace}
            activeSkill={activeSkill}
            onUpdate={updateTemplates}
            onUseTemplate={async (sql) => {
              useSql(sql, "模板 SQL");
              await addHistory({ kind: "template", title: "模板生成 SQL", sql, skillId: activeSkill?.id });
            }}
            onCopy={copySql}
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
        <span className={activeSkill ? "dot ok" : "dot"} />
        <span>{status || "准备就绪"}</span>
      </footer>
    </div>
  );
}

function WorkspaceScope({
  activeSkill,
  databases,
  selectedDatabase,
  scopedTableCount,
  onDatabaseChange
}: {
  activeSkill: DbSkill | null;
  databases: string[];
  selectedDatabase: string | null;
  scopedTableCount: number;
  onDatabaseChange: (database: string | null) => void;
}) {
  return (
    <section className="scope-bar">
      <div>
        <div className="label">工作台 DB</div>
        <div className="muted">
          {activeSkill ? `${activeSkill.tables.length} tables · 当前候选 ${scopedTableCount}` : "导入 DB Skill 后可选择 DB"}
        </div>
      </div>
      <div className="scope-actions">
        <select
          data-testid="workspace-database"
          className="input"
          value={selectedDatabase ?? ""}
          onChange={(event) => onDatabaseChange(event.target.value || null)}
          disabled={!activeSkill}
        >
          <option value="">全部 DB</option>
          {databases.map((database) => (
            <option key={database} value={database}>{database}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

function WriteTab({
  config,
  workspace,
  activeSkill,
  onSqlChange,
  onGenerated,
  onCopy
}: {
  config: ModelConfig;
  workspace: WorkspaceState;
  activeSkill: DbSkill | null;
  onSqlChange: (sql: string) => void;
  onGenerated: (instruction: string, result: GenerateSqlResponse) => Promise<void>;
  onCopy: (sql: string, label?: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("补全这段 SQL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [explanation, setExplanation] = useState("");

  async function completeSql() {
    setLoading(true);
    setError("");
    try {
      const next = await sendRuntime<GenerateSqlResponse>({
        type: "generateSql",
        payload: {
          mode: "complete",
          prompt: instruction,
          currentSql: workspace.sql,
          database: workspace.database,
          skill: activeSkill,
          config
        }
      });
      setExplanation(next.explanation);
      await onGenerated(instruction, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "补全失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <SqlWorkspaceEditor sql={workspace.sql} database={workspace.database} activeSkill={activeSkill} onChange={onSqlChange} />
      <div className="row">
        <button className="ghost-button" onClick={() => onCopy(workspace.sql)} disabled={!workspace.sql.trim()}>
          <Copy size={14} />
          复制 SQL
        </button>
        <button className="ghost-button danger-text" onClick={() => onSqlChange("")} disabled={!workspace.sql}>
          <Trash2 size={14} />
          清空
        </button>
      </div>

      <div className="divider" />
      <label className="label">AI 补全要求</label>
      <input data-testid="workspace-instruction" className="input" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
      <button data-testid="workspace-complete" className="primary-button" onClick={completeSql} disabled={loading || !workspace.sql.trim()}>
        <Wand2 size={16} />
        {loading ? "补全中..." : "补全工作台 SQL"}
      </button>
      {error && <div className="notice danger">{error}</div>}
      {explanation && <div className="notice">{explanation}</div>}
    </section>
  );
}

function SqlWorkspaceEditor({
  sql,
  database,
  activeSkill,
  onChange
}: {
  sql: string;
  database: string | null;
  activeSkill: DbSkill | null;
  onChange: (sql: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const token = getCurrentToken(sql, cursor);
  const suggestions = useMemo(
    () => getWorkspaceSuggestions(activeSkill, token.value, database, sql, token.start),
    [activeSkill, database, sql, token.start, token.value]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [token.value, database]);

  function syncCursor() {
    setCursor(textareaRef.current?.selectionStart ?? sql.length);
  }

  function applySuggestion(suggestion: Suggestion) {
    const nextSql = `${sql.slice(0, token.start)}${suggestion.insertText}${sql.slice(token.end)}`;
    const nextCursor = token.start + suggestion.insertText.length;
    onChange(nextSql);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      applySuggestion(suggestions[selectedIndex]);
    }
  }

  return (
    <div className="workspace-editor">
      <label className="label">SQL 工作台</label>
      <textarea
        ref={textareaRef}
        data-testid="workspace-sql"
        className="textarea sql-editor"
        value={sql}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart ?? event.target.value.length);
        }}
        onClick={syncCursor}
        onKeyUp={syncCursor}
        onSelect={syncCursor}
        onKeyDown={handleKeyDown}
        placeholder="select * from ..."
        spellCheck={false}
      />
      {suggestions.length > 0 && (
        <div className="inline-suggestions">
          {suggestions.map((item, index) => (
            <button
              key={`${item.label}-${item.detail}-${index}`}
              className={index === selectedIndex ? "suggestion active" : "suggestion"}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(item);
              }}
            >
              <Code2 size={15} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AskTab({
  config,
  workspace,
  activeSkill,
  onGenerated,
  onCopy
}: {
  config: ModelConfig;
  workspace: WorkspaceState;
  activeSkill: DbSkill | null;
  onGenerated: (prompt: string, result: GenerateSqlResponse) => Promise<void>;
  onCopy: (sql: string, label?: string) => Promise<void>;
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
          currentSql: workspace.sql,
          database: workspace.database,
          skill: activeSkill,
          config
        }
      });
      setResult(next);
      await onGenerated(prompt, next);
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
        {loading ? "生成中..." : "生成到工作台"}
      </button>
      {error && <div className="notice danger">{error}</div>}
      <SqlResult result={result} onCopy={onCopy} />
    </section>
  );
}

function SqlResult({
  result,
  onCopy
}: {
  result: GenerateSqlResponse | null;
  onCopy: (sql: string, label?: string) => Promise<void>;
}) {
  if (!result) return null;
  return (
    <div className="result">
      <div className="row between">
        <div className="label">生成结果</div>
        <div className="button-group">
          <button className="ghost-button" onClick={() => onCopy(result.sql)}>
            <Copy size={14} />
            复制
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
  onCopy,
  onUse
}: {
  history: SqlHistoryItem[];
  onUpdate: (history: SqlHistoryItem[]) => Promise<void>;
  onCopy: (sql: string, label?: string) => Promise<void>;
  onUse: (sql: string, source?: string) => void;
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
              <button className="ghost-button" onClick={() => onUse(item.sql, item.title)}>
                <Check size={14} />
                使用
              </button>
              <button className="ghost-button" onClick={() => onCopy(item.sql)}>
                <Copy size={14} />
                复制
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
  workspace,
  activeSkill,
  onUpdate,
  onUseTemplate,
  onCopy
}: {
  templates: SqlTemplate[];
  workspace: WorkspaceState;
  activeSkill: DbSkill | null;
  onUpdate: (templates: SqlTemplate[]) => Promise<void>;
  onUseTemplate: (sql: string) => Promise<void>;
  onCopy: (sql: string, label?: string) => Promise<void>;
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

  function loadFromWorkspace() {
    setDraftSql(workspace.sql);
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
          <button className="ghost-button" onClick={loadFromWorkspace} disabled={!workspace.sql.trim()}>
            <Code2 size={15} />
            载入当前 SQL
          </button>
        </div>
        <input data-testid="template-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="模板名称，例如：渠道 GMV 日报" />
        <textarea data-testid="template-sql" className="textarea template-sql" value={draftSql} onChange={(event) => setDraftSql(event.target.value)} placeholder="粘贴 SQL，或从工作台载入" />
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
              <button className="primary-button" onClick={() => onUseTemplate(renderedSql)}>
                <Check size={15} />
                使用到工作台
              </button>
              <button className="ghost-button" onClick={() => onCopy(renderedSql, "模板 SQL")}>
                <Copy size={14} />
                复制
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
                <p>{skill.tables.length} tables · {getDatabaseOptions(skill).length} DBs · {new Date(skill.updatedAt).toLocaleString()}</p>
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
