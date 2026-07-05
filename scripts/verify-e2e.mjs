import { chromium } from "playwright";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const distDir = path.join(root, "dist");
const userDataDir = path.join(os.tmpdir(), "db-skill-copilot-e2e-profile");
const deepseekKey = process.env.DEEPSEEK_API_KEY ?? "";

const skillJson = JSON.stringify(
  {
    name: "demo_analytics",
    dialect: "mysql",
    tables: [
      {
        database: "demo_db",
        name: "dwd_user_register_di",
        description: "用户注册日表",
        business: "用于分析新用户注册、渠道归因和地区分布。",
        columns: [
          { name: "user_id", type: "bigint", description: "用户 ID" },
          { name: "dt", type: "date", description: "分区日期" },
          { name: "channel", type: "varchar", description: "注册渠道" },
          { name: "country", type: "varchar", description: "国家" }
        ]
      },
      {
        database: "demo_db",
        name: "dwd_order_detail_di",
        description: "订单明细日表",
        business: "用于分析支付订单、GMV 和用户购买行为。",
        columns: [
          { name: "order_id", type: "bigint", description: "订单 ID" },
          { name: "user_id", type: "bigint", description: "用户 ID" },
          { name: "pay_amount", type: "decimal", description: "支付金额，单位元" },
          { name: "pay_status", type: "varchar", description: "支付状态，SUCCESS 表示支付成功" },
          { name: "dt", type: "date", description: "分区日期" }
        ]
      }
    ],
    joins: [
      {
        left: "dwd_order_detail_di.user_id",
        right: "dwd_user_register_di.user_id",
        type: "left join",
        description: "订单明细关联注册用户"
      }
    ],
    metrics: [
      {
        name: "GMV",
        expression: "sum(pay_amount)",
        filters: "pay_status = 'SUCCESS'",
        description: "支付成功订单金额"
      }
    ]
  },
  null,
  2
);

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
    await fillTestId(sidepanel, "skill-raw", skillJson);
    await clickTestId(sidepanel, "skill-import");
    await expectText(sidepanel, "demo_analytics", "DB Skill 导入");
    await expectText(sidepanel, "2 tables", "DB Skill table count");
    results.push(["skill_imported", true, "demo_analytics"]);

    await clickTestId(sidepanel, "tab-write");
    await selectTestId(sidepanel, "workspace-database", "demo_db");
    await fillTestId(sidepanel, "workspace-sql", "select * from dwd_ord");
    await expectText(sidepanel, "dwd_order_detail_di", "工作台表名联想");
    await sidepanel.locator('[data-testid="workspace-sql"]').press("Tab");
    const completedSql = await sidepanel.locator('[data-testid="workspace-sql"]').inputValue();
    assert(completedSql.includes("dwd_order_detail_di"), "工作台联想没有补全表名");
    results.push(["workspace_autocomplete", true, "dwd_ord -> dwd_order_detail_di"]);

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
      await clickTestId(sidepanel, "tab-write");
      const sql = await sidepanel.locator("[data-testid='workspace-sql']").inputValue();
      assert(/select/i.test(sql) && /dwd_user_register_di/i.test(sql), "DeepSeek 生成 SQL 未进入工作台");
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

async function selectTestId(page, testId, value) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expectOne(locator, testId);
  await locator.selectOption(value);
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
