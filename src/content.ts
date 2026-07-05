import type { EditorContext } from "./types";

type EditorTarget = {
  element: HTMLElement;
  adapter: string;
};

const BUTTON_ID = "db-skill-copilot-button";

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

function getContext(): EditorContext {
  const target = findEditor();
  return {
    detected: Boolean(target),
    adapter: target?.adapter ?? "none",
    sql: getSql(target),
    selection: getSelectionText(target),
    url: location.href,
    title: document.title
  };
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
