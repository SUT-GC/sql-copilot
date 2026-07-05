import type { DbSkill } from "../src/types";
import { retrieveRelevantSkill, skillToPrompt } from "../src/skill";

const skill: DbSkill = {
  id: "skill_test",
  name: "retrieval_test",
  raw: "large raw should not appear in prompt: events users orders",
  updatedAt: new Date().toISOString(),
  tables: [
    {
      name: "orders",
      description: "订单表",
      columns: [
        { name: "order_id", type: "bigint", description: "订单 ID" },
        { name: "pay_amount", type: "decimal", description: "支付金额" }
      ]
    },
    {
      name: "users",
      description: "用户表",
      columns: [{ name: "user_id", type: "bigint", description: "用户 ID" }]
    },
    {
      name: "events",
      description: "事件表",
      columns: [{ name: "event_name", type: "varchar", description: "事件名" }]
    }
  ],
  joins: [
    { left: "orders.user_id", right: "users.user_id", type: "left join" },
    { left: "events.user_id", right: "users.user_id", type: "left join" }
  ],
  metrics: [
    { name: "GMV", expression: "sum(pay_amount)", filters: "pay_status = 'SUCCESS'" },
    { name: "UV", expression: "count(distinct user_id)" }
  ]
};

const explicit = retrieveRelevantSkill(skill, {
  currentSql: "select pay_amount from orders where",
  prompt: "补全这个 SQL"
});
assertEqual(explicit.skill?.tables.map((table) => table.name).join(","), "orders", "explicit table retrieval");
assertEqual(explicit.skill?.joins.length, 0, "explicit table should not pull unrelated join tables");
const explicitPrompt = skillToPrompt(explicit.skill, explicit.reason);
assert(!explicitPrompt.includes("large raw should not appear"), "raw notes should not be included");
assert(!explicitPrompt.includes("### users"), "explicit prompt should not include users table");

const fuzzy = retrieveRelevantSkill(skill, {
  prompt: "查询支付金额和 GMV",
  currentSql: ""
});
assert(fuzzy.skill?.tables.some((table) => table.name === "orders"), "fuzzy retrieval should include orders");
assert((fuzzy.skill?.tables.length ?? 0) < skill.tables.length, "fuzzy retrieval should reduce table count when possible");

console.log("retrieval checks passed");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
