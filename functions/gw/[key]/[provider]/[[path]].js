// TokenAdvisor cost gateway — bring-your-own-key proxy.
//
//   OpenAI:    base_url = https://tokenadvisor.dev/gw/<project_key>/openai/v1
//   Anthropic: base_url = https://tokenadvisor.dev/gw/<project_key>/anthropic
//
// The customer's own provider key travels in their normal auth header and is forwarded untouched;
// it is never stored or logged. Optional header `x-ta-feature: <name>` tags spend by feature.
//
// Design rules:
//  1. Fail open. If anything in our own logic or storage breaks, the call still goes through.
//  2. Byte-for-byte passthrough except two opt-in/safe edits:
//     - OpenAI streamed chat: add stream_options.include_usage (needed to measure cost) and strip
//       the extra usage-only chunk back out, so client code sees exactly what it would have seen.
//     - Anthropic with auto_cache on: add one cache_control breakpoint on the system prompt, only
//       when the same prefix was seen in the last 5 minutes (so the cache write is likely to pay off).
//  3. Never store prompt or completion text.

import { priceFor, costOf, uncachedCostOf } from "../../../_lib/pricing.js";
import { usageFromJson, sseTap } from "../../../_lib/usage.js";
import { projectByKey, insertRequest, sha256Hex, ensureSchema } from "../../../_lib/db.js";

const DEFAULT_UPSTREAMS = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
};

const LOGGED_ENDPOINTS = {
  openai: new Set(["v1/chat/completions", "v1/responses", "v1/embeddings"]),
  anthropic: new Set(["v1/messages"]),
};

const STRIP_REQ_HEADERS = ["host", "cookie", "content-length", "x-real-ip", "true-client-ip"];
const AUTO_CACHE_MIN_CHARS = 4000; // ≈1,000+ tokens; below the provider minimum the API just doesn't cache
const AUTO_CACHE_WINDOW_MS = 5 * 60_000;

const recentPrefixes = new Map(); // `${project}:${sys_hash}` -> last seen ts (per isolate)

function upstreamBase(env, provider) {
  // Overrides exist for local testing against mock upstreams; production leaves them unset.
  if (provider === "openai" && env.UPSTREAM_OPENAI) return env.UPSTREAM_OPENAI;
  if (provider === "anthropic" && env.UPSTREAM_ANTHROPIC) return env.UPSTREAM_ANTHROPIC;
  return DEFAULT_UPSTREAMS[provider];
}

function errorResponse(status, message, provider) {
  const body =
    provider === "anthropic"
      ? { type: "error", error: { type: "tokenadvisor_gateway_error", message } }
      : { error: { message, type: "tokenadvisor_gateway_error", code: status } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-ta-gateway": "error" },
  });
}

function forwardHeaders(request) {
  const h = new Headers(request.headers);
  for (const name of [...h.keys()]) {
    const l = name.toLowerCase();
    if (STRIP_REQ_HEADERS.includes(l) || l.startsWith("cf-") || l.startsWith("x-forwarded-") || l.startsWith("x-ta-")) {
      h.delete(name);
    }
  }
  return h;
}

function responseHeaders(upstream) {
  const h = new Headers(upstream.headers);
  h.delete("content-length");
  h.delete("content-encoding");
  h.set("x-ta-gateway", "1");
  return h;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text ?? p?.input_text ?? "")).join("\n");
  }
  return "";
}

// The stable prefix the provider can cache: tools + system/developer instructions.
function promptPrefix(provider, endpoint, body) {
  const tools = body.tools ? JSON.stringify(body.tools) : "";
  let sys = "";
  if (provider === "anthropic") {
    sys = textOf(body.system);
  } else if (endpoint === "v1/responses") {
    sys = typeof body.instructions === "string" ? body.instructions : "";
    if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (item?.role === "system" || item?.role === "developer") sys += "\n" + textOf(item.content);
        else break;
      }
    }
  } else if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (m?.role === "system" || m?.role === "developer") sys += "\n" + textOf(m.content);
      else break;
    }
  }
  return tools || sys ? tools + "\u0000" + sys : "";
}

function bodyForDedup(body) {
  const { stream, stream_options, metadata, user, ...rest } = body;
  return JSON.stringify(rest);
}

async function prefixSeenRecently(db, projectId, sysHash, now) {
  const k = `${projectId}:${sysHash}`;
  const mem = recentPrefixes.get(k);
  if (mem && now - mem < AUTO_CACHE_WINDOW_MS) return true;
  const row = await db
    .prepare("SELECT ts FROM requests WHERE project_id = ? AND sys_hash = ? ORDER BY ts DESC LIMIT 1")
    .bind(projectId, sysHash)
    .first();
  return !!row && now - row.ts < AUTO_CACHE_WINDOW_MS;
}

function addAnthropicCacheBreakpoint(body) {
  const cc = { type: "ephemeral" };
  if (typeof body.system === "string") {
    body.system = [{ type: "text", text: body.system, cache_control: cc }];
    return true;
  }
  if (Array.isArray(body.system) && body.system.length) {
    const last = body.system[body.system.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = cc;
      return true;
    }
  }
  return false;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const provider = String(params.provider || "").toLowerCase();
  const key = String(params.key || "");
  const path = (Array.isArray(params.path) ? params.path : [params.path].filter(Boolean)).join("/");

  if (!DEFAULT_UPSTREAMS[provider]) {
    return errorResponse(404, `Unknown provider "${provider}". Use /gw/<key>/openai/v1 or /gw/<key>/anthropic.`, "openai");
  }
  if (!path.startsWith("v1/")) {
    return errorResponse(404, `Path must start with v1/. Check your base_url (see tokenadvisor.dev).`, provider);
  }

  // ── Project lookup (fail open if storage is down) ──
  let project = null;
  let storageOk = !!env.DB;
  if (storageOk) {
    try {
      project = await projectByKey(env.DB, key);
    } catch {
      storageOk = false;
    }
    if (storageOk && !project) {
      return errorResponse(401, "Unknown TokenAdvisor project key in base_url. Get one at tokenadvisor.dev.", provider);
    }
  }

  const url = new URL(request.url);
  const upstreamUrl = `${upstreamBase(env, provider)}/${path}${url.search}`;
  const headers = forwardHeaders(request);
  const feature = (request.headers.get("x-ta-feature") || "").trim().slice(0, 64) || null;
  const shouldLog = !!project && request.method === "POST" && LOGGED_ENDPOINTS[provider].has(path);

  if (!shouldLog) {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders(upstream) });
  }

  const rawBody = await request.text();
  let outBody = rawBody;
  let parsed = null;
  let injectedUsage = false;
  let autoCached = false;
  let sysHash = null;
  let sysChars = 0;
  let bodyHash = null;
  const now = Date.now();

  try {
    parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") {
      const prefix = promptPrefix(provider, path, parsed);
      sysChars = prefix.length;
      sysHash = prefix ? (await sha256Hex(prefix)).slice(0, 32) : null;
      bodyHash = (await sha256Hex(bodyForDedup(parsed))).slice(0, 32);
      let modified = false;

      if (provider === "openai" && path === "v1/chat/completions" && parsed.stream === true &&
          parsed.stream_options?.include_usage !== true) {
        parsed.stream_options = { ...(parsed.stream_options || {}), include_usage: true };
        injectedUsage = true;
        modified = true;
      }

      if (provider === "anthropic" && project.auto_cache && sysHash && sysChars >= AUTO_CACHE_MIN_CHARS &&
          !rawBody.includes('"cache_control"') &&
          (await prefixSeenRecently(env.DB, project.id, sysHash, now))) {
        if (addAnthropicCacheBreakpoint(parsed)) {
          autoCached = true;
          modified = true;
        }
      }
      if (sysHash) recentPrefixes.set(`${project.id}:${sysHash}`, now);
      if (modified) outBody = JSON.stringify(parsed);
    }
  } catch {
    // Not JSON or our logic failed: forward the original body untouched.
    outBody = rawBody;
    injectedUsage = false;
    autoCached = false;
  }

  const upstream = await fetch(upstreamUrl, { method: "POST", headers, body: outBody, redirect: "manual" });
  const rh = responseHeaders(upstream);
  if (autoCached) rh.set("x-ta-auto-cache", "1");
  const requestModel = parsed?.model || null;
  const isStream = (upstream.headers.get("content-type") || "").includes("text/event-stream");

  const log = async (usage, responseModel) => {
    try {
      await ensureSchema(env.DB);
      const model = responseModel || requestModel;
      const price = priceFor(model) || priceFor(requestModel);
      const cost = usage.seen ? costOf(price, usage) : 0;
      let saved = 0;
      if (autoCached && price && usage.seen) saved = uncachedCostOf(price, usage) - cost;
      await insertRequest(env.DB, {
        project_id: project.id,
        ts: now,
        provider,
        endpoint: path,
        model,
        model_id: price?.id || null,
        feature,
        status: upstream.status,
        latency_ms: Date.now() - now,
        stream: isStream,
        input_tokens: usage.input,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite + usage.cacheWrite1h,
        output_tokens: usage.output,
        cost_usd: price ? cost : null,
        saved_usd: saved,
        auto_cached: autoCached,
        sys_hash: sysHash,
        sys_chars: sysChars,
        body_hash: bodyHash,
      });
    } catch (e) {
      console.error("tokenadvisor log failed", e?.message || e);
    }
  };

  if (isStream && upstream.body) {
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    const tap = sseTap(provider, {
      dropUsageChunk: injectedUsage,
      onDone: (acc, meta) => resolveDone({ acc, meta }),
    });
    context.waitUntil(done.then(({ acc, meta }) => log(acc, meta.model)));
    return new Response(upstream.body.pipeThrough(tap), { status: upstream.status, headers: rh });
  }

  const text = await upstream.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  context.waitUntil(log(usageFromJson(provider, json), json?.model || json?.response?.model));
  return new Response(text, { status: upstream.status, headers: rh });
}
