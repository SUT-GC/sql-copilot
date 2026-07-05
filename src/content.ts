const BUTTON_ID = "db-skill-copilot-button";
const BOOTSTRAP_KEY = "__dbSkillCopilotLoaded";

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

if (!(globalThis as Record<string, unknown>)[BOOTSTRAP_KEY]) {
  (globalThis as Record<string, unknown>)[BOOTSTRAP_KEY] = true;
  ensureButton();
}
