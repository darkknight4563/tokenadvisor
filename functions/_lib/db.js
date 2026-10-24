// D1 storage. Binding name: DB. Tables are created on first use, so setup is just
// "create a D1 database and bind it as DB".
// Privacy: no prompt or completion text is ever written — only token counts, model, timing,
// and SHA-256 hashes (used to spot repeated system prompts and duplicate requests).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    dash_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    auto_cache INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    model TEXT,
    model_id TEXT,
    feature TEXT,
    status INTEGER,
    latency_ms INTEGER,
    stream INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    saved_usd REAL NOT NULL DEFAULT 0,
    auto_cached INTEGER NOT NULL DEFAULT 0,
    sys_hash TEXT,
    sys_chars INTEGER NOT NULL DEFAULT 0,
    body_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_req_project_ts ON requests(project_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_req_sys ON requests(project_id, sys_hash, ts)`,
];

let schemaReady = null;
export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix, bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  const s = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}${s}`;
}

// Small per-isolate cache so the hot proxy path doesn't hit D1 for every request.
const projectCache = new Map(); // key_hash -> { project, exp }
const PROJECT_TTL_MS = 60_000;

export async function projectByKey(db, key) {
  if (!key || !/^ta_[A-Za-z0-9_-]{16,64}$/.test(key)) return null;
  const keyHash = await sha256Hex(key);
  const hit = projectCache.get(keyHash);
  if (hit && hit.exp > Date.now()) return hit.project;
  await ensureSchema(db);
  const project = await db
    .prepare("SELECT id, email, auto_cache, created_at FROM projects WHERE key_hash = ?")
    .bind(keyHash)
    .first();
  projectCache.set(keyHash, { project: project || null, exp: Date.now() + PROJECT_TTL_MS });
  return project || null;
}

export async function projectForDashboard(db, key, dashToken) {
  const project = await projectByKey(db, key);
  if (!project || !dashToken) return null;
  const row = await db.prepare("SELECT dash_hash FROM projects WHERE id = ?").bind(project.id).first();
  if (!row) return null;
  const h = await sha256Hex(dashToken);
  return h === row.dash_hash ? project : null;
}

export function forgetProjectCache() {
  projectCache.clear();
}

export async function insertRequest(db, r) {
  await db
    .prepare(
      `INSERT INTO requests (project_id, ts, provider, endpoint, model, model_id, feature, status,
        latency_ms, stream, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
        cost_usd, saved_usd, auto_cached, sys_hash, sys_chars, body_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      r.project_id, r.ts, r.provider, r.endpoint, r.model, r.model_id, r.feature, r.status,
      r.latency_ms, r.stream ? 1 : 0, r.input_tokens, r.cache_read_tokens, r.cache_write_tokens,
      r.output_tokens, r.cost_usd, r.saved_usd, r.auto_cached ? 1 : 0, r.sys_hash, r.sys_chars,
      r.body_hash
    )
    .run();
  // Opportunistic retention: drop rows older than 90 days on ~1% of writes.
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM requests WHERE ts < ?").bind(Date.now() - 90 * 86400_000).run();
  }
}
