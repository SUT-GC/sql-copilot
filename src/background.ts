import { generateSql } from "./llm";
import type { GenerateSqlRequest } from "./types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "openSidePanel" && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch((error) => {
      console.warn("Failed to open side panel", error);
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "generateSql") {
    generateSql(message.payload as GenerateSqlRequest)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
