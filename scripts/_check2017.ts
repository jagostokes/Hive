import "dotenv/config";
import { getPool, closePool, introspectSchema } from "../src/db/index.js";

async function main() {
  const pool = getPool();
  const schema = await introspectSchema(pool);

  // Find tables with a timestamp/date column to inspect their year ranges.
  for (const t of schema.tables) {
    const dateCols = t.columns.filter((c) =>
      /timestamp|date/i.test(c.type),
    );
    if (dateCols.length === 0) continue;
    for (const col of dateCols) {
      const q = `select min("${col.name}") as min, max("${col.name}") as max, count(*) as total,
        count(*) filter (where extract(year from "${col.name}") = 2017) as y2017
        from "${t.schema}"."${t.name}"`;
      try {
        const r = await pool.query(q);
        console.log(`\n${t.schema}.${t.name}.${col.name}:`, r.rows[0]);
      } catch (e) {
        console.log(`\n${t.schema}.${t.name}.${col.name}: ERROR`, (e as Error).message);
      }
    }
  }

  // Distinct years across the most likely "orders" table if present.
  const orders = schema.tables.find((t) => /order/i.test(t.name));
  if (orders) {
    const dateCol = orders.columns.find((c) => /timestamp|date/i.test(c.type));
    if (dateCol) {
      const q = `select extract(year from "${dateCol.name}")::int as yr, count(*) as n
        from "${orders.schema}"."${orders.name}"
        group by 1 order by 1`;
      const r = await pool.query(q);
      console.log(`\nYear breakdown for ${orders.name}.${dateCol.name}:`);
      console.table(r.rows);
    }
  }

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
