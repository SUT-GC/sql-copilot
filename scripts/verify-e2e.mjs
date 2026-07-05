import { chromium } from "playwright";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const distDir = path.join(root, "dist");
const userDataDir = path.join(os.tmpdir(), "db-skill-copilot-e2e-profile");
const deepseekKey = process.env.DEEPSEEK_API_KEY ?? "";

const skill = `# DB Skill: demo_analytics

## Tables

### dwd_user_register_di
用户注册日表。
- user_id (bigint): 用户 ID
- dt (date): 分区日期
- channel (varchar): 注册渠道
- country (varchar): 国家

### dwd_order_detail_di
订单明细日表。
- order_id (bigint): 订单 ID
- user_id (bigint): 用户 ID
- pay_amount (decimal): 支付金额，单位元
- pay_status (varchar): 支付状态，SUCCESS 表示支付成功
- dt (date): 分区日期

## Relationships
- dwd_order_detail_di.user_id = dwd_user_register_di.user_id

## Metrics
- GMV: sum(pay_amount)，只统计 pay_status = 'SUCCESS'
- 新用户数: count(distinct user_id)
`;

const templateSql = `select
  dt,
  channel,
  count(distinct user_id) as new_users
from dwd_user_register_di
where dt between '2026-07-01' and '2026-07-04'
group by dt, channel
order by dt, channel;`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assert(existsSync(path.join(distDir, "manifest.json")), "dist/manifest.json 不存在，请先运行 npm run build");
  const chromePath = process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : "";
  rmSync(userDataDir, { recursive: true, force: true });

  const launchOptions = {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  };
  if (chromePath) launchOptions.executablePath = chromePath;

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  const results = [];
  try {
    const demo = await context.newPage();
    await demo.goto("http://127.0.0.1:5177", { waitUntil: "domcontentloaded" });
    await expectVisible(demo.locator("#db-skill-copilot-button"), "content script 浮动按钮");
    results.push(["content_script_injected", true, "DB button visible"]);
    await demo.locator("#db-skill-copilot-button").click();

    const worker = await getExtensionWorker(context);
    const extensionId = worker.url().split("/")[2];
    results.push(["extension_loaded", Boolean(extensionId), extensionId]);

    await demo.locator("#sql-editor").click();
    await sendContentMessage(worker, { type: "insertSql", sql: "\nselect 42 as inserted_by_copilot;" });
    const insertedSql = await demo.locator("#sql-editor").inputValue();
    assert(insertedSql.includes("inserted_by_copilot"), "content script 插入 SQL 失败");
    results.push(["editor_insert", true, "insertAtCursor"]);

    await sendContentMessage(worker, { type: "setEditorSql", sql: "select 1 as old_value;" });
    await demo.evaluate(() => {
      const editor = document.querySelector("#sql-editor");
      editor.focus();
      const start = editor.value.indexOf("old_value");
      editor.setSelectionRange(start, start + "old_value".length);
    });
    await sendContentMessage(worker, { type: "replaceSelection", sql: "new_value" });
    const replacedSql = await demo.locator("#sql-editor").inputValue();
    assert(replacedSql.includes("new_value") && !replacedSql.includes("old_value"), "content script 替换选区失败");
    results.push(["editor_replace", true, "replaceSelection"]);

    await sendContentMessage(worker, { type: "setEditorSql", sql: templateSql });
    await demo.locator("#run").click();
    await demo.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, null, { timeout: 10000 });
    const rowCount = await demo.locator("tbody tr").count();
    results.push(["demo_mysql_query", rowCount > 0, `${rowCount} rows`]);

    const sidepanel = await context.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded" });

    await clickTestId(sidepanel, "tab-settings");
    await fillTestId(sidepanel, "setting-base-url", "https://api.deepseek.com");
    await fillTestId(sidepanel, "setting-model", "deepseek-chat");
    if (deepseekKey) await fillTestId(sidepanel, "setting-api-key", deepseekKey);
    await clickTestId(sidepanel, "setting-save");
    results.push(["settings_saved", true, "OpenAI-compatible config"]);

    await clickTestId(sidepanel, "tab-skill");
    await fillTestId(sidepanel, "skill-name", "demo_analytics");
    await fillTestId(sidepanel, "skill-raw", skill);
    await clickTestId(sidepanel, "skill-import");
    await expectText(sidepanel, "demo_analytics", "DB Skill 导入");
    results.push(["skill_imported", true, "demo_analytics"]);

    await clickTestId(sidepanel, "tab-complete");
    await fillTestId(sidepanel, "suggestion-query", "pay_amount");
    await expectText(sidepanel, "pay_amount", "本地字段补全");
    results.push(["local_completion", true, "pay_amount suggestion"]);

    await clickTestId(sidepanel, "tab-templates");
    await fillTestId(sidepanel, "template-name", "新用户日报");
    await fillTestId(sidepanel, "template-sql", templateSql);
    await fillTestId(sidepanel, "template-fragment", "2026-07-01");
    await fillTestId(sidepanel, "template-variable-name", "start_date");
    await clickTestId(sidepanel, "template-add-variable");
    await clickTestId(sidepanel, "template-save");
    await expectText(sidepanel, "新用户日报", "模板保存");
    results.push(["template_saved", true, "新用户日报"]);

    if (deepseekKey) {
      await clickTestId(sidepanel, "tab-ask");
      await fillTestId(sidepanel, "ask-prompt", "查询 2026-07-01 到 2026-07-04 每个渠道的新用户数，按日期和渠道排序");
      await clickTestId(sidepanel, "ask-generate");
      await sidepanel.locator("[data-testid='sql-result']").waitFor({ state: "visible", timeout: 90000 });
      const sql = await sidepanel.locator("[data-testid='sql-result']").textContent();
      assert(sql && /select/i.test(sql) && /dwd_user_register_di/i.test(sql), "DeepSeek 生成 SQL 未包含预期表");
      results.push(["ask_deepseek_generation", true, compact(sql)]);

      await clickTestId(sidepanel, "tab-history");
      await expectText(sidepanel, "查询 2026-07-01", "历史记录");
      results.push(["history_recorded", true, "Ask result saved"]);
    } else {
      results.push(["ask_deepseek_generation", false, "skipped: DEEPSEEK_API_KEY not set"]);
      results.push(["history_recorded", false, "skipped: Ask generation skipped"]);
    }
  } finally {
    await context.close();
  }

  console.table(results.map(([name, ok, detail]) => ({ check: name, ok, detail })));
  const failed = results.filter(([, ok, detail]) => !ok && !String(detail).startsWith("skipped"));
  assert(failed.length === 0, `E2E failed: ${failed.map(([name]) => name).join(", ")}`);
}

async function getExtensionWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  return worker;
}

async function sendContentMessage(worker, message) {
  return worker.evaluate(async (payload) => {
    const tabs = await new Promise((resolve) => chrome.tabs.query({ url: "http://127.0.0.1:5177/*" }, resolve));
    if (!tabs[0]?.id) throw new Error("未找到 demo 查询页 tab");
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabs[0].id, payload, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error ?? "content message failed"));
        else resolve(response);
      });
    });
  }, message);
}

async function clickTestId(page, testId) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expectOne(locator, testId);
  await locator.click();
}

async function fillTestId(page, testId, value) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expectOne(locator, testId);
  await locator.fill(value);
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10000 });
  assert(await locator.count() === 1, `${label} 不是唯一元素`);
}

async function expectOne(locator, label) {
  const count = await locator.count();
  assert(count === 1, `${label} expected 1 element, got ${count}`);
}

async function expectText(page, text, label) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), text, { timeout: 10000 });
  const count = await page.getByText(text, { exact: false }).count();
  assert(count >= 1, `${label} 未显示 ${text}`);
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
