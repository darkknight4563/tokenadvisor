(() => {
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get("k") || "";
  const token = params.get("t") || "";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (x, small) => {
    const v = Number(x) || 0;
    if (small && v > 0 && v < 1) return "$" + v.toFixed(4);
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const int = (x) => (Number(x) || 0).toLocaleString("en-US");
  const pct = (x) => ((Number(x) || 0) * 100).toFixed(1) + "%";

  const api = (method, body) =>
    fetch("/api/dash", {
      method,
      headers: { "x-ta-key": key, authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    });

  function snippet() {
    const o = location.origin;
    return `
      <div class="snippets">
        <div class="snip">
          <div class="snip-head">OpenAI · Python</div>
<pre><code>client = OpenAI(
    base_url="${o}/gw/${esc(key)}/openai/v1",
)  # your OPENAI_API_KEY stays where it is</code></pre>
        </div>
        <div class="snip">
          <div class="snip-head">Anthropic · Python</div>
<pre><code>client = Anthropic(
    base_url="${o}/gw/${esc(key)}/anthropic",
)  # your ANTHROPIC_API_KEY stays where it is</code></pre>
        </div>
      </div>
      <p class="dash-muted">Optional: send <code>x-ta-feature: &lt;name&gt;</code> as a header to split spend by feature
      (<code>default_headers={"x-ta-feature": "support-bot"}</code>).</p>`;
  }

  function bars(days) {
    if (!days.length) return "";
    const max = Math.max(...days.map((d) => d.spend_usd), 0.0001);
    // Fixed slots for a 30-day window so a single day doesn't render as one giant bar.
    const slots = Math.max(days.length, 30);
    const w = 100 / slots;
    const offset = (slots - days.length) * w; // newest day sits at the right edge
    const rects = days.map((d, i) => {
      const h = (d.spend_usd / max) * 100;
      return `<rect x="${(offset + i * w + w * 0.15).toFixed(2)}%" y="${(100 - h).toFixed(2)}%" width="${(w * 0.7).toFixed(2)}%" height="${h.toFixed(2)}%">
        <title>${esc(d.day)}: ${usd(d.spend_usd, true)} · ${int(d.requests)} calls</title></rect>`;
    }).join("");
    return `<div class="chart-wrap">
      <svg class="bars" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily spend">${rects}</svg>
      <div class="chart-axis"><span>${esc(days[0].day)}</span><span>peak ${usd(max, true)}/day</span><span>${esc(days[days.length - 1].day)}</span></div>
    </div>`;
  }

  function recCard(r) {
    const toggle = r.toggle === "auto_cache"
      ? `<button class="btn-primary" data-toggle="auto_cache">Turn on auto-caching</button>` : "";
    return `<article class="rec">
      <div class="rec-top">
        <h3>${esc(r.title)}</h3>
        <div class="rec-amt"><span class="mono">${usd(r.monthly_usd)}</span><small>/month</small></div>
      </div>
      <p>${esc(r.detail)}</p>
      <p class="rec-action"><strong>Do this:</strong> ${esc(r.action)}</p>
      <div class="rec-foot">
        <span class="badge ${r.confidence === "measured" ? "badge-good" : "badge-warn"}">${esc(r.confidence)}</span>
        ${r.assumption ? `<span class="dash-muted">${esc(r.assumption)}</span>` : ""}
        ${toggle}
      </div>
    </article>`;
  }

  function table(rows, cols) {
    if (!rows.length) return `<p class="dash-muted">No data yet.</p>`;
    return `<div class="table-scroll"><table class="dtable"><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? "num mono" : ""}">${c.fmt(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function render(d) {
    const t = d.totals;
    const empty = t.requests === 0;
    app.innerHTML = `
      <section class="dash-head">
        <div>
          <div class="eyebrow"><span class="dot"></span>Cost gateway · ${esc(d.project.email)}</div>
          <h1 class="hero-title" style="font-size:30px;text-align:left">Where your AI money goes</h1>
          <p class="dash-muted">Last ${d.window_days} days${empty ? "" : ` · ${d.days_observed} day${d.days_observed === 1 ? "" : "s"} of traffic observed`} · prices as of ${esc(d.pricing_as_of)}</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="autocache" ${d.project.auto_cache ? "checked" : ""}/>
          <span>Auto-caching for Claude <small class="dash-muted">adds a cache breakpoint to repeated long system prompts</small></span>
        </label>
      </section>

      ${empty ? `
        <section class="panel">
          <h2>No traffic yet</h2>
          <p class="dash-muted">Change your base URL and make one call. It shows up here within seconds.</p>
          ${snippet()}
        </section>` : `
        <section class="kpis">
          <div class="kpi"><div class="kpi-label">Spend, last ${d.window_days} days</div><div class="kpi-val mono">${usd(t.spend_usd, true)}</div><div class="kpi-sub">${int(t.requests)} calls</div></div>
          <div class="kpi"><div class="kpi-label">Projected monthly</div><div class="kpi-val mono">${usd(t.projected_monthly_usd)}</div><div class="kpi-sub">at current pace</div></div>
          <div class="kpi kpi-accent"><div class="kpi-label">Savings found</div><div class="kpi-val mono"><small>up to </small>${usd(d.potential_monthly_savings_usd)}<small>/mo</small></div><div class="kpi-sub">${d.recommendations.length} recommendation${d.recommendations.length === 1 ? "" : "s"}${d.recommendations.length > 1 ? " · some overlap" : ""}</div></div>
          <div class="kpi"><div class="kpi-label">Saved by auto-caching</div><div class="kpi-val mono">${usd(t.verified_savings_usd, true)}</div><div class="kpi-sub">${int(t.auto_cached_requests)} calls · measured from billed tokens</div></div>
        </section>

        <section class="panel">
          <h2>What to cut</h2>
          ${d.recommendations.length ? d.recommendations.map(recCard).join("") :
            `<p class="dash-muted">Nothing worth flagging yet. Recommendations need about 20 calls per model or feature before we trust the pattern.</p>`}
        </section>

        <section class="panel">
          <h2>Daily spend</h2>
          ${bars(d.by_day)}
        </section>

        <section class="grid-2">
          <div class="panel">
            <h2>By model</h2>
            ${table(d.by_model, [
              { label: "Model", fmt: (r) => `<span class="mono">${esc(r.model)}</span>${r.priced ? "" : ' <span class="badge badge-warn">unpriced</span>'}` },
              { label: "Calls", num: true, fmt: (r) => int(r.requests) },
              { label: "Spend", num: true, fmt: (r) => usd(r.spend_usd, true) },
              { label: "Avg in / out", num: true, fmt: (r) => `${int(r.avg_input)} / ${int(r.avg_output)}` },
              { label: "Cache hit", num: true, fmt: (r) => pct(r.cache_hit_rate) },
            ])}
          </div>
          <div class="panel">
            <h2>By feature</h2>
            ${table(d.by_feature, [
              { label: "Feature", fmt: (r) => esc(r.feature) },
              { label: "Calls", num: true, fmt: (r) => int(r.requests) },
              { label: "Spend", num: true, fmt: (r) => usd(r.spend_usd, true) },
              { label: "Avg out", num: true, fmt: (r) => int(r.avg_output) },
            ])}
          </div>
        </section>
        ${t.unpriced_requests ? `<p class="dash-muted">${int(t.unpriced_requests)} calls used a model we don't have a price for yet, so they count as $0 above.</p>` : ""}
        <details class="panel"><summary>Setup snippet</summary>${snippet()}</details>
      `}
      <p class="dash-muted small-print">We store token counts, model, timing and SHA-256 hashes, never your prompts or completions. Your provider key is forwarded and never stored. Data is kept for 90 days.</p>
    `;

    const set = async (val) => {
      try { await api("POST", { auto_cache: val }); load(); }
      catch (e) { alert(e.message); }
    };
    document.getElementById("autocache")?.addEventListener("change", (e) => set(e.target.checked));
    app.querySelectorAll("[data-toggle=auto_cache]").forEach((b) => b.addEventListener("click", () => set(true)));
  }

  function load() {
    api("GET").then(render).catch((e) => {
      app.innerHTML = `<section class="panel"><h2>Can't open this dashboard</h2><p class="dash-muted">${esc(e.message)}. Use the full link you got at signup; the part after # is your access key.</p><p><a href="/#gateway">Create a new project →</a></p></section>`;
    });
  }

  if (!key || !token) {
    app.innerHTML = `<section class="panel"><h2>Missing dashboard link</h2><p class="dash-muted">Open the private link you got at signup.</p><p><a href="/#gateway">Create a project →</a></p></section>`;
  } else {
    load();
    setInterval(() => { if (!document.hidden) load(); }, 30000);
  }
})();
