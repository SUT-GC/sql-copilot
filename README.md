# DB Skill Copilot

一个运行在第三方 DB 管理平台里的 Chrome/Edge 插件 MVP。它基于团队维护的 DB Skill，提供：

- SQL 补全：读取当前 SQL，结合表结构和业务口径续写 SQL。
- 对话写 SQL：用自然语言生成 SQL，并可插入当前编辑器。
- SQL 历史：保存问题、SQL、来源和时间，方便复用。
- SQL 模板：把常用 SQL 中的日期、渠道、ID、表名等变量化，下次填表单生成。
- 模型配置：支持 DeepSeek 或任意 OpenAI-compatible `baseUrl` / `apiKey` / `model`。

## 开发

```bash
npm install
npm run build
```

然后在 Chrome 打开 `chrome://extensions`，开启开发者模式，加载 `dist` 目录。

## 本地验证

项目内带了一个模拟第三方 DB 管理平台的 MySQL 查询页。

如果你有 Docker：

```bash
npm run demo:mysql
npm run demo
```

如果要像 E2E 一样使用本机临时 MySQL，可以手动初始化一个 3307 端口实例，导入 `demo/mysql/init.sql` 后启动：

```bash
mysql -h 127.0.0.1 -P 3307 -uroot < demo/mysql/init.sql
MYSQL_PASSWORD= npm run demo
```

完整 E2E 验证：

```bash
npm run build
npx playwright install chromium
DEEPSEEK_API_KEY=sk-xxx npm run verify:e2e
```

验证脚本会检查：

- content script 是否注入到 demo 查询页。
- 插件是否能插入和替换 SQL 编辑器内容。
- demo 页面是否能执行 MySQL 查询。
- Settings 是否能保存 OpenAI-compatible 配置。
- DB Skill 是否能导入。
- 本地表字段补全是否可用。
- SQL 模板是否能保存和渲染。
- 配置 API Key 时，Ask 是否能调用 DeepSeek 生成 SQL，并写入历史。

## 表多时的检索策略

Ask 和 Complete 在调用模型前会先裁剪 DB Skill：

- 如果当前 SQL 里已经出现 `from 表名` 或 `join 表名`，只把这些显式表传给模型，不再检索其他表。
- 如果当前 SQL 还没有表名，会根据用户问题、当前 SQL、字段说明、指标说明检索相关表。
- 传给模型的上下文只包含检索后的 tables、joins、metrics，不会把原始大 JSON 全量塞进 prompt。
- 页面内联想补全仍然使用当前激活 Skill 的本地索引，保证输入表名/字段名时响应足够快。

说明：新版正式版 Chrome 已限制命令行加载未打包扩展，自动化验证默认使用 Playwright 下载的 Chrome for Testing。日常手动使用时仍然可以在 `chrome://extensions` 开发者模式中加载 `dist`。

## MVP 使用路径

1. 在插件侧边栏的 Settings 配置模型，例如：
   - Base URL: `https://api.deepseek.com`
   - Model: `deepseek-chat`
2. 在 Skill 页导入 DB Skill。可以使用 Markdown 或 JSON。
3. 打开 DB 管理平台页面，点击页面右下角 `DB` 按钮或浏览器插件图标打开侧边栏。
4. 在 Ask 用自然语言生成 SQL，或在 Complete 根据当前编辑器内容续写。
5. 生成结果可以插入光标位置、替换选中 SQL、保存历史或保存为模板。

## DB Skill 建议格式

```md
# DB Skill: user_analytics

## Tables

### dwd_user_register_di
用户注册日表。
- user_id: 用户 ID
- dt: 分区日期，格式 yyyy-MM-dd
- channel: 注册渠道

### dwd_order_detail_di
订单明细日表。
- user_id: 用户 ID
- pay_amount: 支付金额，单位元
- pay_status: 支付状态，SUCCESS 表示支付成功
- dt: 分区日期

## Relationships
- dwd_order_detail_di.user_id = dwd_user_register_di.user_id

## Metrics
- GMV: sum(pay_amount)，只统计 pay_status = 'SUCCESS'
```

也可以导入 JSON：

```json
{
  "dialect": "hive",
  "tables": [
    {
      "name": "dwd_order_detail_di",
      "description": "订单明细日表",
      "columns": [
        { "name": "user_id", "type": "bigint", "description": "用户 ID" },
        { "name": "pay_amount", "type": "decimal", "description": "支付金额" }
      ]
    }
  ],
  "metrics": [
    {
      "name": "GMV",
      "expression": "sum(pay_amount)",
      "filters": "pay_status = 'SUCCESS'"
    }
  ]
}
```
