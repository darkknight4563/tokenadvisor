// End-to-end test of the gateway against the mock upstream.
const BASE = "http://127.0.0.1:8788";
const MOCK = "http://127.0.0.1:9999";
let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg, extra ?? ""); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mockLog = async () => (await fetch(MOCK + "/__log")).json();
const lastUpstream = async () => (await mockLog()).at(-1);

const longSys = (seed) => `You are a support agent for Acme ${seed}. ` + "Policy: be concise and accurate. ".repeat(160); // ~5.3k chars

async function main() {
  await fetch(MOCK + "/__reset");

  console.log("signup");
  const bad = await fetch(BASE + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"nope"}' });
  ok(bad.status === 400, "rejects invalid email");
  const s = await (await fetch(BASE + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "cto@acme.io" }) })).json();
  ok(s.project_key?.startsWith("ta_") && s.dashboard_url.includes("#k="), "returns project key + dashboard link", s);
  const key = s.project_key;
  const dashTok = new URLSearchParams(s.dashboard_url.split("#")[1]).get("t");
  const OA = `${BASE}/gw/${key}/openai/v1`;
  const AN = `${BASE}/gw/${key}/anthropic`;
  const dash = () => fetch(BASE + "/api/dash", { headers: { "x-ta-key": key, authorization: "Bearer " + dashTok } }).then((r) => r.json());

  console.log("auth + routing");
  let r = await fetch(`${BASE}/gw/ta_doesnotexist12345678/openai/v1/chat/completions`, { method: "POST", body: "{}" });
  ok(r.status === 401, "unknown project key → 401");
  r = await fetch(`${BASE}/gw/${key}/evilcorp/v1/x`, { method: "POST", body: "{}" });
  ok(r.status === 404, "unknown provider → 404 (no open proxy)");
  const before = (await mockLog()).length;
  r = await fetch(`${BASE}/gw/${key}/openai/v1/..%2F..%2Fadmin`, { method: "GET" });
  const r2 = await fetch(`${BASE}/gw/${key}/openai/%2e%2e/x`, { method: "GET" });
  const hits = (await mockLog()).slice(before).map((x) => x.url);
  ok(hits.every((u) => u.startsWith("/v1/")) && r2.status === 404, "encoded traversal can't escape /v1 on the fixed upstream host", { hits, s2: r2.status });
  r = await fetch(`${OA}/models`, { headers: { authorization: "Bearer sk-test" } });
  ok(r.status === 200, "non-logged endpoint passes through (GET /v1/models)");
  const dashBad = await fetch(BASE + "/api/dash", { headers: { "x-ta-key": key, authorization: "Bearer wrong" } });
  ok(dashBad.status === 401, "dashboard rejects wrong token");

  console.log("openai chat (json)");
  const chatBody = { model: "gpt-6.1-sol", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] };
  r = await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-user-123", "x-ta-feature": "support-bot", "x-mock-out": "500" }, body: JSON.stringify(chatBody) });
  const j = await r.json();
  ok(r.status === 200 && j.choices?.[0]?.message?.content?.startsWith("Hello"), "response passed through");
  ok(r.headers.get("x-request-id") === "mock-123", "upstream headers preserved");
  let up = await lastUpstream();
  ok(up.headers.authorization === "Bearer sk-user-123", "customer's provider key forwarded untouched");
  ok(!Object.keys(up.headers).some((h) => h.startsWith("x-ta-")), "x-ta-* headers stripped before upstream");
  ok(JSON.stringify(up.body) === JSON.stringify(chatBody), "non-streaming body forwarded byte-identical");

  console.log("openai chat (stream, no include_usage)");
  r = await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-user-123", "x-mock-out": "77" }, body: JSON.stringify({ ...chatBody, stream: true }) });
  const streamText = await r.text();
  up = await lastUpstream();
  ok(up.body.stream_options?.include_usage === true, "gateway injected include_usage upstream");
  const events = streamText.split("\n\n").filter(Boolean);
  ok(!streamText.includes('"choices":[]'), "client never sees the injected usage-only chunk");
  ok(events.length === 3 && streamText.trim().endsWith("data: [DONE]"), "other SSE events intact, in order", events.length);

  console.log("openai stream where client already asked for usage");
  r = await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ ...chatBody, stream: true, stream_options: { include_usage: true } }) });
  ok((await r.text()).includes('"choices":[]'), "usage chunk kept when the client requested it");

  console.log("openai responses api");
  r = await fetch(`${OA}/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "gpt-5.4", input: "hi" }) });
  ok(r.status === 200, "responses passthrough");

  console.log("anthropic messages (json + stream)");
  r = await fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "sk-ant-u", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
  ok(r.status === 200 && (await r.json()).content?.[0]?.text === "Hi", "anthropic json passthrough");
  up = await lastUpstream();
  ok(up.headers["x-api-key"] === "sk-ant-u" && up.headers["anthropic-version"] === "2023-06-01", "anthropic auth headers forwarded");
  r = await fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "x-mock-out": "321" }, body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }) });
  const aText = await r.text();
  ok(aText.includes("message_start") && aText.includes("message_stop"), "anthropic stream intact");
  r = await fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-5-5", messages: [] }) });
  ok(r.status === 401, "upstream errors passed through with their status");

  await sleep(800);
  let d = await dash();
  console.log("cost accounting");
  ok(d.totals.requests === 7, "7 logged calls (GET /models not logged)", d.totals.requests);
  const opus = d.by_model.find((m) => m.model === "claude-opus-5-5");
  // mock: input = round(len(JSON.stringify(messages))/3.5), output 40 → opus 5.5 at $4/$20
  const msgs = JSON.stringify([{ role: "user", content: "hi" }]);
  const expectOpus = (Math.round(msgs.length / 3.5) * 4 + 40 * 20) / 1e6;
  ok(opus && Math.abs(opus.spend_usd - expectOpus) < 1e-6, `opus cost exact ($${expectOpus})`, opus);
  const sonnet = d.by_model.find((m) => m.model === "claude-sonnet-5-5");
  ok(sonnet && sonnet.avg_output === 321, "anthropic streamed output tokens captured (321)", sonnet);
  const sol = d.by_model.find((m) => m.model === "gpt-6-1-sol");
  ok(sol && sol.requests === 3, "dated model id from stream normalised to gpt-6-1-sol", sol);
  const resp = d.by_model.find((m) => m.model === "gpt-5-4");
  // 200 uncached * 2.5 + 1000 cached * 0.25 + 100 * 15
  ok(resp && Math.abs(resp.spend_usd - (200 * 2.5 + 1000 * 0.25 + 100 * 15) / 1e6) < 1e-6, "responses api cached tokens priced at cache rate", resp);
  ok(d.by_feature.some((f) => f.feature === "support-bot"), "feature tag recorded");

  console.log("generate traffic patterns");
  // A) 25 identical requests → duplicates
  for (let i = 0; i < 25; i++) {
    await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x", "x-ta-feature": "faq" }, body: JSON.stringify({ model: "gpt-5.5", messages: [{ role: "user", content: "What are your opening hours?" }] }) });
  }
  // B) 25 opus calls with the same long system prompt, short outputs → caching + rightsizing
  const sysA = longSys("A");
  for (let i = 0; i < 25; i++) {
    await fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "x-ta-feature": "triage", "x-mock-out": "12" }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 20, system: sysA, messages: [{ role: "user", content: `ticket ${i}` }] }) });
  }
  // C) 25 openai calls whose long system prompt has a timestamp at the top → unstable prefix
  for (let i = 0; i < 25; i++) {
    await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x", "x-ta-feature": "agent" }, body: JSON.stringify({ model: "gpt-6.1-sol", messages: [{ role: "system", content: `Now: 2026-10-24T08:${String(i).padStart(2, "0")}. ` + longSys("C") }, { role: "user", content: "go" }] }) });
  }
  await sleep(1000);
  d = await dash();
  const ids = d.recommendations.map((x) => x.id);
  console.log("   recs:", d.recommendations.map((x) => `${x.id} $${x.monthly_usd}/mo [${x.confidence}]`).join(" | "));
  ok(ids.includes("duplicates"), "duplicate-request recommendation");
  ok(ids.includes("anthropic-caching"), "anthropic caching recommendation");
  ok(ids.includes("unstable-prefix"), "unstable-prefix recommendation");
  ok(ids.some((x) => x.startsWith("rightsize-triage-claude-opus-5-5")), "right-size triage opus → sonnet");
  ok(d.recommendations.every((x) => x.monthly_usd > 0), "all recommendations carry a positive $ figure");
  const dup = d.recommendations.find((x) => x.id === "duplicates");
  const gpt55 = d.by_model.find((m) => m.model === "gpt-5-5");
  // the 25 faq calls plus 3 identical gpt-6.1-sol calls from earlier (json + 2 streamed: stream flags are ignored)
  const solDup = d.by_model.find((m) => m.model === "gpt-6-1-sol");
  ok(dup && dup.monthly_usd >= Math.round(gpt55.spend_usd * 24 / 25 * 30 * 100) / 100 - 0.01, "duplicate waste ≥ 24/25 of the faq spend, projected", { dup: dup?.monthly_usd, spend: gpt55?.spend_usd });

  console.log("auto-caching");
  r = await fetch(BASE + "/api/dash", { method: "POST", headers: { "x-ta-key": key, authorization: "Bearer " + dashTok, "content-type": "application/json" }, body: '{"auto_cache":true}' });
  ok((await r.json()).auto_cache === true, "auto_cache enabled via dashboard API");
  const sysB = longSys("B");
  const sendB = (i) => fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "x-ta-feature": "kb" }, body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 50, system: sysB, messages: [{ role: "user", content: `q${i}` }] }) });
  r = await sendB(0); await r.text();
  up = await lastUpstream();
  ok(!JSON.stringify(up.body).includes("cache_control"), "first sighting of a prefix: no breakpoint (avoids paying a write that may never be read)");
  await sleep(300);
  r = await sendB(1); await r.text();
  ok(r.headers.get("x-ta-auto-cache") === "1", "repeat within 5 min: breakpoint added");
  up = await lastUpstream();
  ok(Array.isArray(up.body.system) && up.body.system.at(-1).cache_control?.type === "ephemeral" && up.body.system[0].text === sysB, "system converted to block with cache_control, text unchanged");
  for (let i = 2; i < 8; i++) { r = await sendB(i); await r.text(); }
  // explicit cache_control from the customer must never be touched
  const own = { model: "claude-sonnet-5-5", max_tokens: 5, system: [{ type: "text", text: sysB, cache_control: { type: "ephemeral", ttl: "1h" } }], messages: [{ role: "user", content: "x" }] };
  r = await fetch(`${AN}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify(own) });
  await r.text();
  up = await lastUpstream();
  ok(JSON.stringify(up.body) === JSON.stringify(own) && r.headers.get("x-ta-auto-cache") !== "1", "customer's own cache_control left alone");
  await sleep(1000);
  d = await dash();
  // 1 write + 6 reads on sonnet 5.5 ($2 in, $2.5 write, $0.10 read); prefix tokens = round(len/3.5)
  const pt = Math.round(sysB.length / 3.5);
  const expectSaved = (6 * pt * (2 - 0.10) - pt * (2.5 - 2)) / 1e6;
  ok(Math.abs(d.totals.verified_savings_usd - expectSaved) < 1e-5, `verified savings net of write premium = $${expectSaved.toFixed(5)}`, d.totals.verified_savings_usd);
  ok(d.totals.auto_cached_requests === 7, "7 auto-cached calls counted", d.totals.auto_cached_requests);

  console.log("fail-open: non-JSON body still proxied");
  r = await fetch(`${OA}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: "not json{" });
  up = await lastUpstream();
  ok(up && r.status === 200, "malformed body forwarded, upstream answered");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
