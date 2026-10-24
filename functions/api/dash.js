// GET  /api/dash  → spend + recommendations     (headers: x-ta-key, authorization: Bearer <dashboard token>)
// POST /api/dash  { auto_cache: true|false }      → update settings
import { projectForDashboard, forgetProjectCache } from "../_lib/db.js";
import { buildDashboard } from "../_lib/insights.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function auth(request, env) {
  if (!env.DB) return null;
  const key = request.headers.get("x-ta-key") || "";
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return projectForDashboard(env.DB, key, token);
}

export async function onRequestGet({ request, env }) {
  const project = await auth(request, env);
  if (!project) return json({ error: "Invalid dashboard link." }, 401);
  return json(await buildDashboard(env.DB, project));
}

export async function onRequestPost({ request, env }) {
  const project = await auth(request, env);
  if (!project) return json({ error: "Invalid dashboard link." }, 401);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (typeof body.auto_cache !== "boolean") return json({ error: "auto_cache must be true or false" }, 400);
  await env.DB.prepare("UPDATE projects SET auto_cache = ? WHERE id = ?").bind(body.auto_cache ? 1 : 0, project.id).run();
  forgetProjectCache();
  return json({ ok: true, auto_cache: body.auto_cache });
}
