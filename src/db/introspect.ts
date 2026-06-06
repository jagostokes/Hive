import type { Pool } from "pg";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

export interface SchemaDescription {
  tables: TableInfo[];
}

export interface IntrospectOptions {
  // Which Postgres schemas to scan. Defaults to the user schema `public`,
  // where InsForge places user-created tables.
  schemas?: string[];
  // Table names to omit (e.g. the app's own infrastructure tables). This is the
  // only place names are referenced, and they are passed in by the caller — the
  // introspector itself makes no domain assumptions.
  excludeTables?: string[];
}

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
}

// USER-DEFINED columns (e.g. pgvector `vector`, enums) report a generic
// data_type; the concrete type lives in udt_name.
function resolveType(row: ColumnRow): string {
  return row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type;
}

/**
 * Reads information_schema and returns a compact description of every base table
 * in the target schema(s). Works for ANY schema it finds — no table or column
 * names are hardcoded.
 */
export async function introspectSchema(
  pool: Pool,
  opts: IntrospectOptions = {},
): Promise<SchemaDescription> {
  const schemas = opts.schemas ?? ["public"];
  const exclude = new Set((opts.excludeTables ?? []).map((t) => t.toLowerCase()));

  const { rows } = await pool.query<ColumnRow>(
    `select c.table_schema,
            c.table_name,
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema
        and t.table_name = c.table_name
      where t.table_type = 'BASE TABLE'
        and c.table_schema = any($1)
      order by c.table_schema, c.table_name, c.ordinal_position`,
    [schemas],
  );

  const byTable = new Map<string, TableInfo>();
  for (const row of rows) {
    if (exclude.has(row.table_name.toLowerCase())) continue;
    const key = `${row.table_schema}.${row.table_name}`;
    let table = byTable.get(key);
    if (!table) {
      table = { schema: row.table_schema, name: row.table_name, columns: [] };
      byTable.set(key, table);
    }
    table.columns.push({
      name: row.column_name,
      type: resolveType(row),
      nullable: row.is_nullable === "YES",
    });
  }

  return { tables: [...byTable.values()] };
}
