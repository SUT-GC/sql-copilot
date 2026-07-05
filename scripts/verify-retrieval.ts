import type { DbSkill } from "../src/types";
import { filterTablesByDatabase, parseDbSkill, retrieveRelevantSkill, skillToPrompt } from "../src/skill";

const skill: DbSkill = {
  id: "skill_test",
  name: "retrieval_test",
  raw: "large raw should not appear in prompt: events users orders",
  updatedAt: new Date().toISOString(),
  tables: [
    {
      database: "life_opact",
      name: "orders",
      description: "订单表",
      columns: [
        { name: "order_id", type: "bigint", description: "订单 ID" },
        { name: "pay_amount", type: "decimal", description: "支付金额" }
      ]
    },
    {
      database: "life_opact",
      name: "users",
      description: "用户表",
      columns: [{ name: "user_id", type: "bigint", description: "用户 ID" }]
    },
    {
      database: "other_db, life_opact",
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

const parsedWithTail = parseDbSkill(`${JSON.stringify({ name: "tail_test", tables: [] })}\nDB`, "fallback");
assertEqual(parsedWithTail.name, "tail_test", "parser should tolerate accidental trailing text after JSON");
const parsedArray = parseDbSkill(JSON.stringify([{ database: "life_opact", name: "array_table", columns: [] }]), "array_skill");
assertEqual(parsedArray.tables[0]?.name, "array_table", "parser should support JSON array skill input");
assert(filterTablesByDatabase(skill.tables, "life_opact").some((table) => table.name === "events"), "multi database string should match a single scoped database");

const explicit = retrieveRelevantSkill(skill, {
  currentSql: "select pay_amount from orders where",
  prompt: "补全这个 SQL",
  database: "life_opact"
});
assertEqual(explicit.skill?.tables.map((table) => table.name).join(","), "orders", "explicit table retrieval");
assertEqual(explicit.skill?.joins.length, 0, "explicit table should not pull unrelated join tables");
const explicitPrompt = skillToPrompt(explicit.skill, explicit.reason);
assert(!explicitPrompt.includes("large raw should not appear"), "raw notes should not be included");
assert(!explicitPrompt.includes("### users"), "explicit prompt should not include users table");

const fuzzy = retrieveRelevantSkill(skill, {
  prompt: "查询支付金额和 GMV",
  currentSql: "",
  database: "life_opact"
});
assert(fuzzy.skill?.tables.some((table) => table.name === "orders"), "fuzzy retrieval should include orders");
assert((fuzzy.skill?.tables.length ?? 0) < skill.tables.length, "fuzzy retrieval should reduce table count when possible");
assert(!fuzzy.skill?.tables.some((table) => table.database === "other_db"), "database scope should exclude pure other_db tables");

console.log("retrieval checks passed");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
