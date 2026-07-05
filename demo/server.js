import express from "express";
import mysql from "mysql2/promise";

const app = express();
const port = Number(process.env.DEMO_PORT ?? 5177);

const dbConfig = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3307),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "db_skill_copilot",
  database: process.env.MYSQL_DATABASE ?? "analytics_demo",
  multipleStatements: false
};

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo DB Query Console</title>
    <style>
      :root { font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f7f8fb; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      header { padding: 18px 22px; background: #fff; border-bottom: 1px solid #e1e5ee; }
      main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, .8fr); gap: 18px; padding: 18px; }
      h1 { margin: 0; font-size: 18px; }
      p { margin: 6px 0 0; color: #667085; font-size: 13px; }
      section { background: #fff; border: 1px solid #e1e5ee; border-radius: 8px; padding: 14px; }
      textarea { width: 100%; min-height: 360px; resize: vertical; padding: 12px; border: 1px solid #d7deea; border-radius: 7px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; outline: none; }
      textarea:focus { border-color: #6b8afd; box-shadow: 0 0 0 3px rgba(107, 138, 253, .16); }
      button { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; margin-top: 10px; padding: 0 14px; border: 0; border-radius: 7px; color: #fff; background: #2f5bea; font-weight: 700; cursor: pointer; }
      button:disabled { opacity: .6; cursor: not-allowed; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { padding: 8px 9px; border-bottom: 1px solid #e1e5ee; text-align: left; }
      th { background: #f0f3f9; font-weight: 700; }
      pre { overflow: auto; margin: 0; padding: 10px; border-radius: 7px; background: #111827; color: #e5e7eb; font-size: 12px; }
      .error { color: #b42318; background: #fff0f0; border-radius: 7px; padding: 10px; }
      @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Demo DB Query Console</h1>
      <p>一个模拟第三方 DB 管理平台的简单 MySQL 查询页面，用来验证插件读取、插入和替换 SQL。</p>
    </header>
    <main>
      <section>
        <textarea id="sql-editor">select
  dt,
  channel,
  count(distinct user_id) as new_users
from dwd_user_register_di
where dt between '2026-07-01' and '2026-07-04'
group by dt, channel
order by dt, channel;</textarea>
        <button id="run">Run SQL</button>
      </section>
      <section>
        <div id="result"><pre>等待查询...</pre></div>
      </section>
    </main>
    <script>
      const editor = document.getElementById("sql-editor");
      const result = document.getElementById("result");
      const button = document.getElementById("run");
      button.addEventListener("click", async () => {
        button.disabled = true;
        result.innerHTML = "<pre>查询中...</pre>";
        try {
          const response = await fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: editor.value })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "query failed");
          result.innerHTML = renderTable(payload.rows);
        } catch (error) {
          result.innerHTML = '<div class="error">' + String(error.message || error) + '</div>';
        } finally {
          button.disabled = false;
        }
      });
      function renderTable(rows) {
        if (!rows.length) return "<pre>空结果</pre>";
        const columns = Object.keys(rows[0]);
        return "<table><thead><tr>" + columns.map((column) => "<th>" + escapeHtml(column) + "</th>").join("") + "</tr></thead><tbody>" +
          rows.map((row) => "<tr>" + columns.map((column) => "<td>" + escapeHtml(String(row[column])) + "</td>").join("") + "</tr>").join("") +
          "</tbody></table>";
      }
      function escapeHtml(value) {
        return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
      }
    </script>
  </body>
</html>`);
});

app.post("/api/query", async (req, res) => {
  const sql = String(req.body?.sql ?? "").trim();
  if (!sql) {
    res.status(400).json({ error: "SQL 不能为空" });
    return;
  }
  if (!/^select\b/i.test(sql)) {
    res.status(400).json({ error: "Demo 页面只允许 SELECT 查询" });
    return;
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.query({ sql, rowsAsArray: false });
    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "查询失败" });
  } finally {
    await connection?.end();
  }
});

app.listen(port, () => {
  console.log(`Demo DB Query Console: http://127.0.0.1:${port}`);
});
