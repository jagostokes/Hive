/**
 * Seeds business_glossary with term -> SQL-expression hints for the REAL
 * imported (Olist) schema. These are what context.forSql() injects so the SQL
 * agent knows the non-obvious joins/metrics: revenue lives in order_payments,
 * region = customers.customer_state, there is no "paid" order_status, etc.
 *
 *   npm run seed:glossary      (or: npx tsx scripts/seedGlossary.ts)
 *
 * Idempotent: replaces all glossary rows with the canonical set below.
 * Requires DATABASE_URL.
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";

interface Entry {
  term: string;
  definition: string;
  sqlExpression: string;
}

const ENTRIES: Entry[] = [
  {
    term: "revenue",
    definition:
      "Total monetary value of orders. Sum payment_value from order_payments (join order_payments.order_id = orders.order_id). Do NOT use order_items.price for revenue.",
    sqlExpression: "sum(order_payments.payment_value)",
  },
  {
    term: "region",
    definition:
      "Customer region = the Brazilian state. Join orders.customer_id = customers.customer_id and group by customers.customer_state.",
    sqlExpression: "customers.customer_state",
  },
  {
    term: "order date",
    definition:
      "When the order was placed. Use this for time-series trends and any year/month/date filtering.",
    sqlExpression: "orders.order_purchase_timestamp",
  },
  {
    term: "paid order",
    definition:
      "There is NO 'paid' value in order_status. An order is paid when it has a row in order_payments. Valid order_status values: approved, canceled, created, delivered, invoiced, processing, shipped, unavailable.",
    sqlExpression: "orders.order_id in (select order_id from order_payments)",
  },
  {
    term: "delivered order",
    definition: "An order that reached the customer (completed lifecycle).",
    sqlExpression: "orders.order_status = 'delivered'",
  },
  {
    term: "order count",
    definition: "Number of orders = count of distinct order_id in orders.",
    sqlExpression: "count(distinct orders.order_id)",
  },
  {
    term: "average order value",
    definition:
      "Mean revenue per order = total payment_value divided by the number of distinct orders.",
    sqlExpression:
      "sum(order_payments.payment_value) / nullif(count(distinct orders.order_id), 0)",
  },
  {
    term: "product category",
    definition:
      "Product category. English names come from product_category_name_translation joined on product_category_name.",
    sqlExpression: "product_category_name_translation.product_category_name_english",
  },
];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL in .env first.");
    process.exit(1);
  }
  const pool = getPool();
  await pool.query("delete from business_glossary");
  let id = 1;
  for (const e of ENTRIES) {
    await pool.query(
      "insert into business_glossary (id, term, definition, sql_expression) values ($1, $2, $3, $4)",
      [id++, e.term, e.definition, e.sqlExpression],
    );
  }
  const { rows } = await pool.query(
    "select id, term, sql_expression from business_glossary order by id",
  );
  console.log(`Seeded business_glossary (${rows.length} rows):`);
  console.table(rows);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
