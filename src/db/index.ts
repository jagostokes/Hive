// db: connect to InsForge Postgres and discover the schema at runtime
// (tables, columns, types). No table/column names are hardcoded.
export { getPool, closePool } from "./client.js";
export {
  introspectSchema,
  type SchemaDescription,
  type TableInfo,
  type ColumnInfo,
  type IntrospectOptions,
} from "./introspect.js";
