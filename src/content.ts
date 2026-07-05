import type { DbSkill, EditorContext, UrlScopeRule } from "./types";

type EditorTarget = {
  element: HTMLElement;
  adapter: string;
};

type CompletionItem = {
  label: string;
  detail: string;
  insertText: string;
  kind: "table" | "column" | "metric" | "keyword";
};

type CompletionContext = "table" | "expression" | "any";

type CompletionState = {
  element: HTMLTextAreaElement | HTMLInputElement;
  token: string;
  start: number;
  end: number;
  items: CompletionItem[];
  selectedIndex: number;
};

const BUTTON_ID = "db-skill-copilot-button";
const COMPLETION_ID = "db-skill-copilot-completion";
const MIN_TOKEN_LENGTH = 1;

let completionState: CompletionState | null = null;
let completionItems: CompletionItem[] = [];
let currentDatabase: string | null = null;

function findEditor(): EditorTarget | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && isEditable(active)) {
    return { element: active, adapter: getAdapterName(active) };
  }

  const textarea = document.querySelector<HTMLTextAreaElement>(
    "textarea, .cm-content[contenteditable='true'], [contenteditable='true'], .ace_text-input, .monaco-editor textarea"
  );
  if (!textarea) return null;
  return { element: textarea, adapter: getAdapterName(textarea) };
}

function isEditable(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "textarea" || tag === "input" || element.isContentEditable || element.getAttribute("contenteditable") === "true";
}

function getAdapterName(element: HTMLElement): string {
  if (element.closest(".monaco-editor")) return "monaco-dom";
  if (element.closest(".cm-editor") || element.classList.contains("cm-content")) return "codemirror-dom";
  if (element.closest(".ace_editor") || element.classList.contains("ace_text-input")) return "ace-dom";
  if (element.tagName.toLowerCase() === "textarea") return "textarea";
  if (element.isContentEditable) return "contenteditable";
  return "editable";
}

function getSql(target: EditorTarget | null): string {
  if (!target) return "";
  const { element } = target;
  if (isTextControl(element)) return element.value;
  if (target.adapter === "codemirror-dom") {
    return element.textContent ?? "";
  }
  return element.textContent ?? "";
}

function getSelectionText(target: EditorTarget | null): string {
  if (!target) return "";
  const { element } = target;
  if (isTextControl(element)) {
    return element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

function insertAtCursor(text: string): boolean {
  const target = findEditor();
  if (!target) return false;
  const { element } = target;
  element.focus();
  if (isTextControl(element)) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    element.value = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
    const nextPosition = start + text.length;
    element.setSelectionRange(nextPosition, nextPosition);
    dispatchInput(element);
    return true;
  }
  return document.execCommand("insertText", false, text);
}

function replaceSelection(text: string): boolean {
  const target = findEditor();
  if (!target) return false;
  const { element } = target;
  element.focus();
  if (isTextControl(element)) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? element.value.length;
    if (start === end) return insertAtCursor(text);
    element.value = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
    element.setSelectionRange(start, start + text.length);
    dispatchInput(element);
    return true;
  }
  return document.execCommand("insertText", false, text);
}

function setEditorSql(text: string): boolean {
  const target = findEditor();
  if (!target) return false;
  const { element } = target;
  element.focus();
  if (isTextControl(element)) {
    element.value = text;
    element.setSelectionRange(text.length, text.length);
    dispatchInput(element);
    return true;
  }
  element.textContent = text;
  dispatchInput(element);
  return true;
}

function isTextControl(element: HTMLElement): element is HTMLTextAreaElement | HTMLInputElement {
  const tag = element.tagName.toLowerCase();
  return tag === "textarea" || tag === "input";
}

function dispatchInput(element: HTMLElement): void {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function loadCompletionItems(): Promise<void> {
  const data = await chrome.storage.local.get(["skills", "activeSkillId", "urlScopeRules"]);
  const skills = (data.skills ?? []) as DbSkill[];
  const urlScopeRules = (data.urlScopeRules ?? []) as UrlScopeRule[];
  currentDatabase = inferDatabaseFromUrlForPage(location.href, urlScopeRules);
  const activeSkill = skills.find((skill) => skill.id === data.activeSkillId) ?? skills[0] ?? null;
  completionItems = buildCompletionItems(activeSkill, currentDatabase);
}

function buildCompletionItems(skill: DbSkill | null, database: string | null): CompletionItem[] {
  const keywords: CompletionItem[] = [
    "select",
    "from",
    "where",
    "group by",
    "order by",
    "left join",
    "inner join",
    "count(distinct )",
    "sum()",
    "date_format()"
  ].map((keyword) => ({ label: keyword, detail: "SQL keyword", insertText: keyword, kind: "keyword" }));

  if (!skill) return keywords;

  const items: CompletionItem[] = [...keywords];
  for (const table of filterTablesByDatabase(skill.tables, database)) {
    items.push({
      label: table.name,
      detail: [table.database, table.description || table.business].filter(Boolean).join(" · ") || "表",
      insertText: table.name,
      kind: "table"
    });
    for (const column of table.columns ?? []) {
      items.push({
        label: column.name,
        detail: `${table.name}${column.type ? ` · ${column.type}` : ""}${column.description ? ` · ${column.description}` : ""}`,
        insertText: column.name,
        kind: "column"
      });
    }
  }

  for (const metric of skill.metrics) {
    items.push({
      label: metric.name,
      detail: metric.expression || metric.description || "指标",
      insertText: metric.expression || metric.name,
      kind: "metric"
    });
  }

  return items;
}

function handleEditorInput(event: Event): void {
  const element = event.target as HTMLElement | null;
  if (!element || !isTextControl(element)) {
    hideCompletion();
    return;
  }
  updateCompletion(element);
}

function updateCompletion(element: HTMLTextAreaElement | HTMLInputElement): void {
  const cursor = element.selectionStart ?? element.value.length;
  const beforeCursor = element.value.slice(0, cursor);
  const match = beforeCursor.match(/([A-Za-z_][\w.]*)$/);
  if (!match) {
    hideCompletion();
    return;
  }

  const token = match[1];
  if (token.length < MIN_TOKEN_LENGTH) {
    hideCompletion();
    return;
  }

  const start = cursor - token.length;
  const context = inferCompletionContext(getCompletionPrefix(element, beforeCursor.slice(0, start), token));
  const items = completionItems
    .filter((item) => isAllowedInContext(item, context))
    .filter((item) => {
      const haystack = `${item.label} ${item.detail} ${item.insertText}`.toLowerCase();
      return haystack.includes(token.toLowerCase());
    })
    .sort((a, b) => scoreCompletion(a, token, context) - scoreCompletion(b, token, context))
    .slice(0, 8);

  if (!items.length) {
    hideCompletion();
    return;
  }

  completionState = {
    element,
    token,
    start,
    end: cursor,
    items,
    selectedIndex: 0
  };
  renderCompletion();
}

function getCompletionPrefix(element: HTMLElement, typedPrefix: string, token: string): string {
  if (inferCompletionContext(typedPrefix) !== "any") return typedPrefix;

  const visibleText = getVisibleEditorText(element);
  if (!visibleText) return typedPrefix;

  const tokenIndex = visibleText.toLowerCase().lastIndexOf(token.toLowerCase());
  return tokenIndex >= 0 ? visibleText.slice(0, tokenIndex) : visibleText;
}

function getVisibleEditorText(element: HTMLElement): string {
  const monaco = element.closest(".monaco-editor");
  if (monaco) {
    return Array.from(monaco.querySelectorAll<HTMLElement>(".view-line"))
      .map((line) => line.textContent ?? "")
      .join("\n");
  }

  const codeMirror = element.closest(".cm-editor");
  if (codeMirror) {
    return Array.from(codeMirror.querySelectorAll<HTMLElement>(".cm-line"))
      .map((line) => line.textContent ?? "")
      .join("\n");
  }

  const ace = element.closest(".ace_editor");
  if (ace) {
    return Array.from(ace.querySelectorAll<HTMLElement>(".ace_line"))
      .map((line) => line.textContent ?? "")
      .join("\n");
  }

  return "";
}

function inferCompletionContext(sqlBeforeToken: string): CompletionContext {
  const lower = stripQuotedSql(sqlBeforeToken).toLowerCase();
  const clausePattern =
    /\b(select|from|join|where|on|group\s+by|order\s+by|having|limit|update|into|delete\s+from|values|set)\b/g;
  const clauses = Array.from(lower.matchAll(clausePattern));
  const lastClause = clauses[clauses.length - 1]?.[1]?.replace(/\s+/g, " ");

  if (!lastClause) return "any";
  if (["from", "join", "update", "into", "delete from"].includes(lastClause)) return "table";
  if (["select", "where", "on", "having", "group by", "order by", "set"].includes(lastClause)) return "expression";

  return "any";
}

function stripQuotedSql(sql: string): string {
  return sql.replace(/'([^']|'')*'/g, " ").replace(/"([^"]|"")*"/g, " ").replace(/`[^`]*`/g, " ");
}

function isAllowedInContext(item: CompletionItem, context: CompletionContext): boolean {
  if (context === "table") return item.kind === "table";
  if (context === "expression") return item.kind !== "table";
  return true;
}

function scoreCompletion(item: CompletionItem, token: string, context: CompletionContext): number {
  const label = item.label.toLowerCase();
  const needle = token.toLowerCase();
  let score = 20;
  if (label === needle) score -= 12;
  else if (label.startsWith(needle)) score -= 8;
  else if (label.includes(needle)) score -= 4;

  if (context === "table" && item.kind === "table") score -= 6;
  if (context === "expression" && item.kind === "column") score -= 4;
  if (item.kind === "table") score -= 3;
  if (item.kind === "column") score -= 2;
  if (item.kind === "metric") score -= 1;

  return score;
}

function handleCompletionKeydown(event: KeyboardEvent): void {
  if (!completionState || !isTextControl(event.target as HTMLElement)) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    completionState.selectedIndex = (completionState.selectedIndex + 1) % completionState.items.length;
    renderCompletion();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    completionState.selectedIndex = (completionState.selectedIndex - 1 + completionState.items.length) % completionState.items.length;
    renderCompletion();
    return;
  }

  if (event.key === "Tab" || event.key === "Enter") {
    event.preventDefault();
    applyCompletion(completionState.selectedIndex);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideCompletion();
  }
}

function renderCompletion(): void {
  if (!completionState) return;
  let popup = document.getElementById(COMPLETION_ID);
  if (!popup) {
    popup = document.createElement("div");
    popup.id = COMPLETION_ID;
    popup.setAttribute(
      "style",
      [
        "position: fixed",
        "z-index: 2147483647",
        "min-width: 280px",
        "max-width: 460px",
        "max-height: 260px",
        "overflow: auto",
        "border: 1px solid #d7deea",
        "border-radius: 8px",
        "background: #ffffff",
        "box-shadow: 0 14px 38px rgba(15, 23, 42, .20)",
        "padding: 5px",
        "font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      ].join(";")
    );
    document.documentElement.appendChild(popup);
  }

  const rect = getCaretClientRect(completionState.element);
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 480))}px`;
  popup.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 270)}px`;
  popup.innerHTML = "";

  completionState.items.forEach((item, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.dataset.index = String(index);
    option.setAttribute(
      "style",
      [
        "display: grid",
        "grid-template-columns: 70px minmax(0, 1fr)",
        "gap: 8px",
        "width: 100%",
        "border: 0",
        "border-radius: 6px",
        "padding: 7px 8px",
        "text-align: left",
        "cursor: pointer",
        `background: ${index === completionState?.selectedIndex ? "#e8edf8" : "#ffffff"}`,
        "color: #172033"
      ].join(";")
    );
    option.innerHTML = `<span style="color:#2f5bea;font-weight:700">${escapeHtml(item.kind)}</span><span style="min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.label)}</strong><small style="display:block;color:#667085;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.detail)}</small></span>`;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyCompletion(index);
    });
    popup.appendChild(option);
  });
}

function applyCompletion(index: number): void {
  if (!completionState) return;
  const item = completionState.items[index];
  const { element, start, end } = completionState;
  element.value = `${element.value.slice(0, start)}${item.insertText}${element.value.slice(end)}`;
  const nextCursor = start + item.insertText.length;
  element.setSelectionRange(nextCursor, nextCursor);
  dispatchInput(element);
  hideCompletion();
}

function hideCompletion(): void {
  completionState = null;
  document.getElementById(COMPLETION_ID)?.remove();
}

function getCaretClientRect(element: HTMLTextAreaElement | HTMLInputElement): DOMRect {
  if (element.tagName.toLowerCase() === "input") {
    const rect = element.getBoundingClientRect();
    return new DOMRect(rect.left + 12, rect.bottom - 6, 0, 0);
  }

  const style = window.getComputedStyle(element);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const cursor = element.selectionStart ?? element.value.length;
  const before = element.value.slice(0, cursor);
  const after = element.value.slice(cursor) || ".";
  const properties = [
    "boxSizing",
    "width",
    "height",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "textTransform",
    "lineHeight",
    "wordSpacing",
    "tabSize"
  ] as const;

  mirror.setAttribute(
    "style",
    [
      "position: fixed",
      "left: -9999px",
      "top: 0",
      "white-space: pre-wrap",
      "overflow-wrap: break-word",
      "visibility: hidden"
    ].join(";")
  );
  for (const property of properties) {
    mirror.style[property] = style[property];
  }

  mirror.textContent = before;
  marker.textContent = after[0] === "\n" ? "." : after[0];
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const elementRect = element.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const left = elementRect.left + markerRect.left - mirrorRect.left - element.scrollLeft;
  const top = elementRect.top + markerRect.top - mirrorRect.top - element.scrollTop;
  const rect = new DOMRect(left, top, 0, Number.parseFloat(style.lineHeight) || 18);
  mirror.remove();
  return rect;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function getContext(): EditorContext {
  const target = findEditor();
  return {
    detected: Boolean(target),
    adapter: target?.adapter ?? "none",
    sql: getSql(target),
    selection: getSelectionText(target),
    url: location.href,
    title: document.title,
    database: currentDatabase ?? inferDatabaseFromUrlForPage(location.href)
  };
}

function filterTablesByDatabase(tables: DbSkill["tables"], database: string | null): DbSkill["tables"] {
  if (!database) return tables;
  const normalized = normalizeName(database);
  return tables.filter((table) => !table.database || splitDatabaseNames(table.database).includes(normalized));
}

function normalizeName(value: string): string {
  return value.toLowerCase().trim();
}

function splitDatabaseNames(value: string): string[] {
  return value.split(",").map(normalizeName).filter(Boolean);
}

function inferDatabaseFromUrlForPage(url: string, rules: UrlScopeRule[] = []): string | null {
  for (const rule of rules) {
    if (matchesPattern(url, rule.urlPattern)) return rule.database;
  }

  const parsed = safeUrl(url);
  if (!parsed) return null;
  const rdsMatch = parsed.pathname.match(/\/rds\/detail\/db\/[^/]+\/([^/]+)(?:\/|$)/i);
  if (rdsMatch) return decodeURIComponent(rdsMatch[1]);
  const dbPathMatch = parsed.pathname.match(/\/(?:db|database|schema)\/([^/]+)(?:\/|$)/i);
  if (dbPathMatch) return decodeURIComponent(dbPathMatch[1]);
  for (const key of ["db", "database", "schema"]) {
    const value = parsed.searchParams.get(key);
    if (value) return value;
  }
  return null;
}

function matchesPattern(url: string, pattern: string): boolean {
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

function ensureButton(): void {
  if (document.getElementById(BUTTON_ID)) return;
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.textContent = "DB";
  button.title = "打开 DB Skill Copilot";
  button.setAttribute(
    "style",
    [
      "position: fixed",
      "right: 18px",
      "bottom: 18px",
      "z-index: 2147483647",
      "width: 42px",
      "height: 42px",
      "border-radius: 8px",
      "border: 1px solid rgba(0,0,0,.18)",
      "background: #111827",
      "color: #fff",
      "font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      "box-shadow: 0 8px 24px rgba(0,0,0,.18)",
      "cursor: pointer"
    ].join(";")
  );
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openSidePanel" }).catch(() => undefined);
  });
  document.documentElement.appendChild(button);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getEditorContext") {
    sendResponse({ ok: true, result: getContext() });
    return true;
  }
  if (message?.type === "insertSql") {
    sendResponse({ ok: insertAtCursor(message.sql ?? "") });
    return true;
  }
  if (message?.type === "replaceSelection") {
    sendResponse({ ok: replaceSelection(message.sql ?? "") });
    return true;
  }
  if (message?.type === "setEditorSql") {
    sendResponse({ ok: setEditorSql(message.sql ?? "") });
    return true;
  }
  return false;
});

ensureButton();
loadCompletionItems().catch(() => undefined);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.skills || changes.activeSkillId || changes.urlScopeRules)) {
    loadCompletionItems().catch(() => undefined);
  }
});

document.addEventListener("input", handleEditorInput, true);
document.addEventListener("keyup", (event) => {
  if (event.key.length === 1 && isTextControl(event.target as HTMLElement)) {
    updateCompletion(event.target as HTMLTextAreaElement | HTMLInputElement);
  }
}, true);
document.addEventListener("keydown", handleCompletionKeydown, true);
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(`#${COMPLETION_ID}`) && !isTextControl(target as HTMLElement)) hideCompletion();
}, true);
document.addEventListener("scroll", hideCompletion, true);
