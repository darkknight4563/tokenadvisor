// Turns logged traffic into spend breakdowns and dollar-quantified recommendations.
// Every recommendation says whether its number is "measured" (from actual billed tokens) or an
// "estimate" (depends on an assumption we state).

import { PRICES, DOWNGRADE, costOf, PRICING_AS_OF } from "./pricing.js";

const DAY = 86400_000;
const WINDOW_DAYS = 30;
const CHARS_PER_TOKEN = 3.5; // prefix size is estimated from characters — we never store the text

const round = (x, d = 2) => Math.round((x || 0) * 10 ** d) / 10 ** d;

export async function buildDashboard(db, project, now = Date.now()) {
  const since = now - WINDOW_DAYS * DAY;
  const P = project.id;
  const q = (sql, ...b) => db.prepare(sql).bind(...b);

  const [totalsR, dayR, modelR, featureR, dupR, cacheR, churnR, sizeR] = await db.batch([
    q(`SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(saved_usd),0) saved, MIN(ts) first_ts,
        COALESCE(SUM(input_tokens),0) input, COALESCE(SUM(cache_read_tokens),0) cache_read,
        COALESCE(SUM(cache_write_tokens),0) cache_write, COALESCE(SUM(output_tokens),0) output,
        SUM(CASE WHEN cost_usd IS NULL AND status < 300 THEN 1 ELSE 0 END) unpriced,
        SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) errors,
        SUM(auto_cached) auto_cached
       FROM requests WHERE project_id = ? AND ts >= ?`, P, since),
    q(`SELECT date(ts/1000, 'unixepoch') day, COUNT(*) n, COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(saved_usd),0) saved
       FROM requests WHERE project_id = ? AND ts >= ? GROUP BY day ORDER BY day`, P, since),
    q(`SELECT COALESCE(model_id, model, 'unknown') model, provider, COUNT(*) n, COALESCE(SUM(cost_usd),0) cost,
        SUM(cost_usd IS NULL) unpriced,
        AVG(input_tokens + cache_read_tokens + cache_write_tokens) avg_in, AVG(output_tokens) avg_out,
        SUM(cache_read_tokens) cache_read, SUM(input_tokens + cache_read_tokens + cache_write_tokens) prompt
       FROM requests WHERE project_id = ? AND ts >= ? GROUP BY 1, 2 ORDER BY cost DESC LIMIT 50`, P, since),
    q(`SELECT COALESCE(feature, '(untagged)') feature, COUNT(*) n, COALESCE(SUM(cost_usd),0) cost,
        AVG(output_tokens) avg_out
       FROM requests WHERE project_id = ? AND ts >= ? GROUP BY 1 ORDER BY cost DESC LIMIT 50`, P, since),
    // Identical request bodies (ignoring stream flags) sent more than once.
    q(`SELECT COALESCE(feature, '(untagged)') feature, COUNT(*) n, COALESCE(SUM(cost_usd),0) cost
       FROM requests WHERE project_id = ? AND ts >= ? AND status < 300 AND body_hash IS NOT NULL
       GROUP BY body_hash HAVING n > 1`, P, since),
    // Anthropic: long, repeated prefixes that are never cached. "warm" = a repeat within 5 min.
    q(`SELECT model_id, sys_hash, MAX(sys_chars) sys_chars, COUNT(*) n,
        SUM(CASE WHEN prev_ts IS NOT NULL AND ts - prev_ts < 300000 THEN 1 ELSE 0 END) warm,
        SUM(cache_read_tokens) cache_read, SUM(auto_cached) auto_cached
       FROM (SELECT model_id, sys_hash, sys_chars, ts, cache_read_tokens, auto_cached,
               LAG(ts) OVER (PARTITION BY sys_hash, model_id ORDER BY ts) prev_ts
             FROM requests WHERE project_id = ? AND ts >= ? AND provider = 'anthropic'
               AND sys_hash IS NOT NULL AND sys_chars >= 4000 AND status < 300 AND model_id IS NOT NULL)
       GROUP BY model_id, sys_hash`, P, since),
    // Long prefixes that change on (almost) every call — caching can never hit.
    q(`SELECT model_id, COUNT(*) n, COUNT(DISTINCT sys_hash) distinct_prefixes, AVG(sys_chars) avg_chars,
        SUM(cache_read_tokens) cache_read
       FROM requests WHERE project_id = ? AND ts >= ? AND sys_hash IS NOT NULL AND sys_chars >= 4000
         AND status < 300 AND model_id IS NOT NULL
       GROUP BY model_id`, P, since),
    // Model right-sizing candidates: per feature + model token totals.
    q(`SELECT COALESCE(feature, '(untagged)') feature, model_id, COUNT(*) n,
        SUM(input_tokens) input, SUM(cache_read_tokens) cache_read, SUM(cache_write_tokens) cache_write,
        SUM(output_tokens) output, COALESCE(SUM(cost_usd),0) cost,
        AVG(input_tokens + cache_read_tokens + cache_write_tokens) avg_in, AVG(output_tokens) avg_out
       FROM requests WHERE project_id = ? AND ts >= ? AND status < 300 AND model_id IS NOT NULL
         AND endpoint != 'v1/embeddings'
       GROUP BY 1, 2`, P, since),
  ]);

  const t = totalsR.results[0] || {};
  const daysObserved = t.first_ts ? Math.min(WINDOW_DAYS, Math.max(1, (now - t.first_ts) / DAY)) : 0;
  const factor = daysObserved ? WINDOW_DAYS / daysObserved : 0;
  const recs = [];

  // 1. Duplicate requests
  {
    let waste = 0, dupCalls = 0;
    const byFeature = {};
    for (const r of dupR.results) {
      const w = r.cost * (r.n - 1) / r.n;
      waste += w;
      dupCalls += r.n - 1;
      byFeature[r.feature] = (byFeature[r.feature] || 0) + w;
    }
    if (waste > 0) {
      const top = Object.entries(byFeature).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
      recs.push({
        id: "duplicates",
        title: "Cache identical requests",
        detail: `${dupCalls.toLocaleString("en-US")} calls were exact repeats of an earlier request (same model, messages and parameters). ` +
          `Serving repeats from a response cache removes that spend entirely. Biggest sources: ${top.join(", ")}.`,
        action: "Add a response cache keyed on the request body for these features. Skip it where you rely on varied outputs at temperature > 0.",
        monthly_usd: round(waste * factor),
        confidence: "measured",
      });
    }
  }

  // 2. Anthropic prompt caching on repeated prefixes
  {
    let net = 0, calls = 0, prefixes = 0;
    for (const r of cacheR.results) {
      const price = PRICES[r.model_id];
      if (!price || r.cache_read > 0 || r.auto_cached > 0 || r.warm < 2) continue;
      const tok = r.sys_chars / CHARS_PER_TOKEN;
      const gain = r.warm * tok * (price.input - price.cacheRead) / 1e6;
      const premium = (r.n - r.warm) * tok * (price.cacheWrite - price.input) / 1e6;
      if (gain - premium <= 0) continue;
      net += gain - premium;
      calls += r.n;
      prefixes++;
    }
    if (net > 0) {
      recs.push({
        id: "anthropic-caching",
        title: "Turn on prompt caching for repeated Claude prompts",
        detail: `${prefixes} long system prompt${prefixes > 1 ? "s were" : " was"} (${calls.toLocaleString("en-US")} calls) re-sent within 5 minutes ` +
          `but never cached. Cached reads cost 5–10% of normal input. The figure is net of the cache-write premium.`,
        action: project.auto_cache
          ? "Auto-caching is on and will apply from now on."
          : "Switch on auto-caching below (one click, reversible), or add cache_control to your system prompt yourself.",
        monthly_usd: round(net * factor),
        confidence: "estimate",
        assumption: `Prefix size estimated at ${CHARS_PER_TOKEN} characters per token.`,
        toggle: project.auto_cache ? null : "auto_cache",
      });
    }
  }

  // 3. Prefixes that change on every call (dynamic content at the top of the prompt)
  {
    let est = 0;
    const models = [];
    for (const r of churnR.results) {
      const price = PRICES[r.model_id];
      if (!price || !price.cacheRead || r.n < 20) continue;
      if (r.distinct_prefixes / r.n < 0.8) continue;
      const tok = r.avg_chars / CHARS_PER_TOKEN;
      est += r.n * 0.5 * tok * (price.input - price.cacheRead) / 1e6;
      models.push(r.model_id);
    }
    if (est > 0) {
      recs.push({
        id: "unstable-prefix",
        title: "Your system prompt changes on every call, so caching can never hit",
        detail: `On ${models.join(", ")}, more than 80% of calls with a long system prompt had a prefix we had never seen before. ` +
          `That usually means a timestamp, user name or retrieved data sits at the top of the prompt.`,
        action: "Move anything that changes per request to the end (into the user message). Keep tools and instructions byte-identical across calls.",
        monthly_usd: round(est * factor),
        confidence: "estimate",
        assumption: "Assumes half of the prefix is static once dynamic content is moved down.",
      });
    }
  }

  // 4. Model right-sizing for short, simple calls
  {
    const items = [];
    for (const r of sizeR.results) {
      const target = DOWNGRADE[r.model_id];
      if (!target || r.n < 20 || r.avg_out > 300 || r.avg_in > 6000) continue;
      const usage = { input: r.input, cacheRead: r.cache_read, cacheWrite: r.cache_write, cacheWrite1h: 0, output: r.output };
      const targetCost = costOf({ id: target, ...PRICES[target] }, usage);
      const save = r.cost - targetCost;
      if (save <= 0) continue;
      items.push({ feature: r.feature, from: r.model_id, to: target, save, n: r.n, avg_out: r.avg_out });
    }
    items.sort((a, b) => b.save - a.save);
    for (const it of items.slice(0, 3)) {
      recs.push({
        id: `rightsize-${it.feature}-${it.from}`,
        title: `Try ${it.to} for "${it.feature}"`,
        detail: `${it.n.toLocaleString("en-US")} calls on ${it.from} average only ${Math.round(it.avg_out)} output tokens, ` +
          `which looks like classification, extraction or short-answer work. The same tokens on ${it.to} cost less.`,
        action: `Replay ~50 recent "${it.feature}" inputs on ${it.to} and compare outputs before switching.`,
        monthly_usd: round(it.save * factor),
        confidence: "estimate",
        assumption: "Assumes the same token counts on the cheaper model and that quality holds. Verify on a sample first.",
      });
    }
  }

  recs.sort((a, b) => b.monthly_usd - a.monthly_usd);

  return {
    project: { email: project.email, created_at: project.created_at, auto_cache: !!project.auto_cache },
    window_days: WINDOW_DAYS,
    days_observed: round(daysObserved, 1),
    pricing_as_of: PRICING_AS_OF,
    totals: {
      requests: t.n || 0,
      spend_usd: round(t.cost, 6),
      projected_monthly_usd: round(t.cost * factor),
      verified_savings_usd: round(t.saved, 6),
      projected_monthly_savings_usd: round(t.saved * factor),
      tokens: { input: t.input || 0, cache_read: t.cache_read || 0, cache_write: t.cache_write || 0, output: t.output || 0 },
      unpriced_requests: t.unpriced || 0,
      errors: t.errors || 0,
      auto_cached_requests: t.auto_cached || 0,
    },
    potential_monthly_savings_usd: round(recs.reduce((s, r) => s + r.monthly_usd, 0)),
    recommendations: recs,
    by_day: dayR.results.map((r) => ({ day: r.day, requests: r.n, spend_usd: round(r.cost, 6), saved_usd: round(r.saved, 6) })),
    by_model: modelR.results.map((r) => ({
      model: r.model, provider: r.provider, requests: r.n, spend_usd: round(r.cost, 6), priced: !r.unpriced,
      avg_input: Math.round(r.avg_in || 0), avg_output: Math.round(r.avg_out || 0),
      cache_hit_rate: r.prompt ? round(r.cache_read / r.prompt, 3) : 0,
    })),
    by_feature: featureR.results.map((r) => ({ feature: r.feature, requests: r.n, spend_usd: round(r.cost, 6), avg_output: Math.round(r.avg_out || 0) })),
  };
}
