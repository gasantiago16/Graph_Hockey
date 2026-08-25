/**
 * SQLite adapter for matches/events.
 *
 * DESIGN names better-sqlite3. That package is a native addon (Visual Studio
 * Build Tools on Windows). CI has no native addons. This module uses sql.js
 * (SQLite compiled to WASM) behind the same `Db` surface so a native driver
 * can replace it later. LangGraph checkpoints belong in a *separate* file
 * (`data/checkpoints.sqlite`) — see checkpointer.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const MEMORY_PATH = ":memory:";
export const DEFAULT_DB_FILENAME = "graph-hockey.sqlite";

export function defaultDbPath(root = process.cwd()): string {
  return join(root, "data", DEFAULT_DB_FILENAME);
}

export type SqlParams = readonly unknown[];

export type RunResult = { changes: number };

export type Statement = {
  run: (...params: unknown[]) => RunResult;
  get: <T = Record<string, unknown>>(...params: unknown[]) => T | undefined;
  all: <T = Record<string, unknown>>(...params: unknown[]) => T[];
};

export type Db = {
  readonly path: string;
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  pragma: (sql: string) => unknown;
  transaction: <T>(fn: () => T) => T;
  close: () => void;
};

type SqlJsStmt = {
  bind: (params?: unknown[] | Record<string, unknown>) => boolean;
  step: () => boolean;
  getAsObject: () => Record<string, unknown>;
  reset: () => void;
  free: () => void;
};

type SqlJsDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => { columns: string[]; values: unknown[][] }[];
  prepare: (sql: string) => SqlJsStmt;
  close: () => void;
  export: () => Uint8Array;
  getRowsModified: () => number;
};

type SqlJsStatic = {
  Database: new (data?: Buffer | Uint8Array | null) => SqlJsDatabase;
};

const require = createRequire(import.meta.url);
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const initSqlJs = require("sql.js") as (cfg?: { wasmBinary: Uint8Array }) => Promise<SqlJsStatic>;
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const wasmBinary = readFileSync(wasmPath);
    sqlJsPromise = initSqlJs({ wasmBinary });
  }
  return sqlJsPromise;
}

function isMemoryPath(path: string): boolean {
  return path === MEMORY_PATH || path === "";
}

function bindArgs(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

class SqlJsStatement implements Statement {
  constructor(
    private readonly inner: SqlJsStmt,
    private readonly db: SqlJsDatabase,
    private readonly onWrite: () => void,
  ) {}

  run(...params: unknown[]): RunResult {
    this.inner.bind(bindArgs(params));
    this.inner.step();
    this.inner.reset();
    this.onWrite();
    return { changes: this.db.getRowsModified() };
  }

  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined {
    this.inner.bind(bindArgs(params));
    const has = this.inner.step();
    const row = has ? (this.inner.getAsObject() as T) : undefined;
    this.inner.reset();
    return row;
  }

  all<T = Record<string, unknown>>(...params: unknown[]): T[] {
    this.inner.bind(bindArgs(params));
    const rows: T[] = [];
    while (this.inner.step()) {
      rows.push(this.inner.getAsObject() as T);
    }
    this.inner.reset();
    return rows;
  }
}

class SqlJsDb implements Db {
  private closed = false;
  private dirty = false;

  constructor(
    readonly path: string,
    private readonly inner: SqlJsDatabase,
  ) {}

  exec(sql: string): void {
    this.inner.exec(sql);
    if (!/^\s*(SELECT|PRAGMA)/i.test(sql)) this.markDirty();
  }

  prepare(sql: string): Statement {
    const stmt = this.inner.prepare(sql);
    const writes = !/^\s*(SELECT|PRAGMA)/i.test(sql);
    return new SqlJsStatement(stmt, this.inner, writes ? () => this.markDirty() : () => {});
  }

  pragma(sql: string): unknown {
    const text = sql.trim().toLowerCase().startsWith("pragma") ? sql : `PRAGMA ${sql}`;
    const res = this.inner.exec(text);
    const first = res[0]?.values[0];
    if (!first) return undefined;
    return first.length === 1 ? first[0] : first;
  }

  transaction<T>(fn: () => T): T {
    this.inner.run("BEGIN");
    try {
      const out = fn();
      this.inner.run("COMMIT");
      this.markDirty();
      this.flush();
      return out;
    } catch (err) {
      this.inner.run("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.inner.close();
    this.closed = true;
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private flush(): void {
    if (this.closed || !this.dirty || isMemoryPath(this.path)) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, Buffer.from(this.inner.export()));
    this.dirty = false;
  }
}

function userVersion(inner: SqlJsDatabase): number {
  const res = inner.exec("PRAGMA user_version");
  const v = res[0]?.values[0]?.[0];
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function migrate(db: Db): void {
  const version = Number(db.pragma("user_version") ?? 0);
  if (version === 0) {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    db.exec(schema);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  if (version === SCHEMA_VERSION) return;
  throw new Error(`unsupported graph-hockey db version ${version} (expected ${SCHEMA_VERSION})`);
}

function applyPragmas(inner: SqlJsDatabase): void {
  inner.run("PRAGMA foreign_keys = ON");
}

function openInner(SQL: SqlJsStatic, path: string): SqlJsDatabase {
  if (isMemoryPath(path)) return new SQL.Database();
  if (existsSync(path)) {
    return new SQL.Database(readFileSync(path));
  }
  mkdirSync(dirname(path), { recursive: true });
  return new SQL.Database();
}

/** Open a match-events DB. `:memory:` (default) is used in tests. */
export async function openDb(path: string = MEMORY_PATH): Promise<Db> {
  const SQL = await loadSqlJs();
  const inner = openInner(SQL, path);
  applyPragmas(inner);
  const db = new SqlJsDb(path, inner);
  migrate(db);
  return db;
}

export async function openMemoryDb(): Promise<Db> {
  return openDb(MEMORY_PATH);
}
