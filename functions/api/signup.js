// POST /api/signup  { email }  →  project key (goes in base_url) + private dashboard link.
import { ensureSchema, randomToken, sha256Hex } from "../_lib/db.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const recentByIp = new Map(); // per-isolate soft rate limit
const LIMIT_PER_HOUR = 5;

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.DB) return json({ error: "Signups are not open yet (storage not configured)." }, 503);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hourAgo = Date.now() - 3600_000;
  const hits = (recentByIp.get(ip) || []).filter((t) => t > hourAgo);
  if (hits.length >= LIMIT_PER_HOUR) return json({ error: "Too many signups from this address. Try again later." }, 429);

  let email = "";
  try {
    email = String((await request.json()).email || "").trim().toLowerCase();
  } catch {
    return json({ error: "Send JSON: { \"email\": \"you@company.com\" }" }, 400);
  }
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email)) return json({ error: "Enter a valid work email." }, 400);

  await ensureSchema(env.DB);
  const id = crypto.randomUUID();
  const projectKey = randomToken("ta_");
  const dashToken = randomToken("tad_");
  await env.DB.prepare(
    "INSERT INTO projects (id, key_hash, dash_hash, email, auto_cache, created_at) VALUES (?,?,?,?,0,?)"
  ).bind(id, await sha256Hex(projectKey), await sha256Hex(dashToken), email, Date.now()).run();

  hits.push(Date.now());
  recentByIp.set(ip, hits);

  const origin = new URL(request.url).origin;
  const dashboardUrl = `${origin}/dashboard/#k=${encodeURIComponent(projectKey)}&t=${encodeURIComponent(dashToken)}`;

  // Optional: tell the founder about every signup so they can follow up personally.
  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    waitUntil(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.NOTIFY_FROM || "TokenAdvisor <onboarding@resend.dev>",
          to: [env.NOTIFY_EMAIL],
          subject: `New TokenAdvisor gateway signup: ${email}`,
          text: `${email} created a gateway project (${id}).`,
        }),
      }).catch(() => {})
    );
  }

  return json({
    project_key: projectKey,
    dashboard_url: dashboardUrl,
    base_urls: {
      openai: `${origin}/gw/${projectKey}/openai/v1`,
      anthropic: `${origin}/gw/${projectKey}/anthropic`,
    },
    note: "Save the dashboard link: it is the only way to view this project, and we can't show it again.",
  });
}
