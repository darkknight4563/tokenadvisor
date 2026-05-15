const TOKEN_COLORS = [
  "#4ECDC4", "#FF6B6B", "#FFE66D", "#A8E6CF", "#FF8B94",
  "#B5EAD7", "#C7CEEA", "#FFDAC1", "#E2F0CB", "#FCB9AA",
  "#F8B500", "#6C5CE7", "#A29BFE", "#FD79A8", "#00CEC9",
  "#55EFC4", "#74B9FF", "#DFE6E9", "#FDA7DF", "#F9CA24",
];

const PLACEHOLDER_PROMPT = `You are an AI assistant. I would like you to please ensure that you carefully analyze and thoroughly review the following text. It is important that you make sure to provide a comprehensive and detailed summary. Thank you for your help.

Before you start, let me explain what I need: I need you to take this article and summarize the key points step by step in detail. Please follow these instructions:

1. Read the entire article
2. Identify the main themes
3. Write a summary of each theme
4. Provide a final conclusion

If you don't mind, could you possibly also suggest improvements?`;

function TokenVis({ tokenTexts }) {
  const [tooltip, setTooltip] = React.useState(null);

  if (!tokenTexts || tokenTexts.length === 0) return null;
  const display = tokenTexts.slice(0, 500);

  return React.createElement("div", { className: "token-vis" },
    display.map((text, i) =>
      React.createElement("span", {
        key: i,
        className: "token-chip",
        style: { backgroundColor: TOKEN_COLORS[i % TOKEN_COLORS.length] + "25", color: TOKEN_COLORS[i % TOKEN_COLORS.length] },
        onMouseEnter: (e) => setTooltip({ x: e.clientX, y: e.clientY, id: i, text }),
        onMouseLeave: () => setTooltip(null),
      }, text || " ")
    ),
    tokenTexts.length > 500 && React.createElement("span", { className: "token-chip", style: { color: "var(--text-faint)" } }, `+${tokenTexts.length - 500} more`),
    tooltip && React.createElement("div", {
      className: "token-chip-tooltip",
      style: { left: tooltip.x + 12, top: tooltip.y - 28 },
    }, `Token #${tooltip.id}`)
  );
}

function TokenColumn({ provider, label, models, count, source, pending, note, children }) {
  const badge = pending ? "pending" : source === "tiktoken" || source === "api" ? "verified" : "fallback";
  const badgeLabel = pending ? "counting..." : source === "tiktoken" ? "exact (tiktoken)" : source === "api" ? "exact (API)" : "estimate";

  return React.createElement("div", { className: "token-col" },
    React.createElement("div", { className: "token-col-header" },
      React.createElement("span", { className: "token-col-provider" }, label),
      React.createElement("span", { className: "token-col-models" }, models)
    ),
    React.createElement("div", { className: "token-col-body" },
      children,
      React.createElement("div", { className: `token-col-count${pending ? " pending" : ""}` }, fmtInt(count)),
      React.createElement("div", { className: "token-col-meta" },
        React.createElement("span", { className: `tt-badge tt-badge-${badge}` }, badgeLabel),
        count > 0 && !pending && React.createElement("span", null, ` · ${(count / Math.max(1, count)).toFixed(1)} char/tok ratio: ${(document.getElementById("prompt-input")?.value?.length / Math.max(1, count) || 0).toFixed(1)}`)
      ),
      note && React.createElement("div", { className: "token-col-note" }, note)
    )
  );
}

function ComparisonStrip({ openai, anthropic, google }) {
  if (openai.tokens === 0) return null;
  const base = openai.tokens;
  const diffClaude = anthropic.tokens - base;
  const diffGemini = google.tokens - base;
  const pctClaude = base > 0 ? ((diffClaude / base) * 100).toFixed(0) : "0";
  const pctGemini = base > 0 ? ((diffGemini / base) * 100).toFixed(0) : "0";

  const fmtDiff = (diff, pct) => {
    if (diff === 0) return React.createElement("span", null, " (same)");
    const cls = diff > 0 ? "diff-up" : "diff-down";
    const sign = diff > 0 ? "+" : "";
    return React.createElement("span", { className: cls }, ` (${sign}${pct}%)`);
  };

  return React.createElement("div", { className: "comparison-strip" },
    "Same text, different counts: ",
    React.createElement("span", { className: "count-highlight" }, `GPT ${fmtInt(openai.tokens)}`),
    " · ",
    React.createElement("span", { className: "count-highlight" }, `Claude ${fmtInt(anthropic.tokens)}`),
    fmtDiff(diffClaude, pctClaude),
    " · ",
    React.createElement("span", { className: "count-highlight" }, `Gemini ${fmtInt(google.tokens)}`),
    fmtDiff(diffGemini, pctGemini)
  );
}

function CostSection({ inputTokens, requestsPerDay, setRequestsPerDay, outputTokens, setOutputTokens, cacheEnabled, setCacheEnabled }) {
  const cachePct = cacheEnabled ? 70 : 0;
  const costs = MODELS.map(m => ({
    ...m,
    monthly: computeMonthlyCost({ model: m, inputTokens, outputTokens, requestsPerDay, cachePct }),
  })).sort((a, b) => a.monthly - b.monthly);

  const cheapestCost = costs[0]?.monthly ?? 0;

  return React.createElement("div", { className: "cost-section" },
    React.createElement("div", { className: "section-head" },
      React.createElement("h2", null, "Monthly Cost Comparison"),
      React.createElement("p", null, "What this prompt costs at scale across providers")
    ),
    React.createElement("div", { className: "cost-controls" },
      React.createElement("div", { className: "cost-control" },
        React.createElement("label", null, "Requests / day"),
        React.createElement("input", { type: "range", className: "slider", min: 100, max: 100000, step: 100, value: requestsPerDay,
          onChange: (e) => setRequestsPerDay(Number(e.target.value)) }),
        React.createElement("span", { className: "cost-value" }, fmtInt(requestsPerDay))
      ),
      React.createElement("div", { className: "cost-control" },
        React.createElement("label", null, "Avg output tokens"),
        React.createElement("input", { type: "range", className: "slider", min: 50, max: 4000, step: 50, value: outputTokens,
          onChange: (e) => setOutputTokens(Number(e.target.value)) }),
        React.createElement("span", { className: "cost-value" }, fmtInt(outputTokens))
      ),
      React.createElement("div", { className: "toggle-row" },
        React.createElement("button", { className: "toggle", role: "switch", "aria-checked": String(cacheEnabled),
          onClick: () => setCacheEnabled(!cacheEnabled) }),
        React.createElement("span", { className: "toggle-label" }, "Prompt caching (70% hit)")
      )
    ),
    React.createElement("div", { className: "cost-grid" },
      costs.map(c =>
        React.createElement("div", { key: c.id, className: `cost-card${c.monthly === cheapestCost ? " cheapest" : ""}` },
          React.createElement("div", { className: "cost-card-provider" }, c.provider),
          React.createElement("div", { className: "cost-card-name" }, c.name),
          React.createElement("div", { className: "cost-card-price" }, fmtUSD(c.monthly)),
          React.createElement("div", { className: "cost-card-period" }, "/month"),
          c.monthly === cheapestCost && React.createElement("span", { className: "badge badge-cheap" }, "cheapest")
        )
      )
    ),
    React.createElement("div", { className: "cost-crosslink" },
      "For full pricing across 20+ models, see ",
      React.createElement("a", { href: "https://realaicost.com", target: "_blank", rel: "noopener" }, "RealAICost →")
    )
  );
}

function AdvisorSection({ text, setText, inputTokens, requestsPerDay, outputTokens, cacheEnabled }) {
  const results = React.useMemo(() => runAdvisor(text), [text]);

  const costPerToken = React.useMemo(() => {
    const sonnet = MODELS.find(m => m.id === "sonnet-4-6");
    if (!sonnet) return 0;
    const cachePct = cacheEnabled ? 70 : 0;
    const cacheFrac = cachePct / 100;
    const effRate = sonnet.input * (1 - cacheFrac) + (sonnet.cacheRead ?? sonnet.input) * cacheFrac;
    return (effRate / 1e6) * requestsPerDay * 30;
  }, [requestsPerDay, cacheEnabled]);

  const totalTokensSaved = results.reduce((s, r) => s + r.totalTokensSaved, 0);
  const totalMonthlySavings = totalTokensSaved * costPerToken;

  const handleApply = (rule) => {
    setText(applyFix(text, rule));
  };

  const handleApplyAll = () => {
    setText(applyAllFixes(text, results));
  };

  if (results.length === 0) {
    return React.createElement("div", { className: "advisor-section" },
      React.createElement("div", { className: "section-head" },
        React.createElement("h2", null, "Advisor"),
        React.createElement("p", null, "Pattern-matching engine that finds wasteful tokens")
      ),
      React.createElement("div", { className: "advisor-empty" },
        React.createElement("div", { className: "check" }, "✓"),
        "Your prompt looks lean. Nice work."
      )
    );
  }

  return React.createElement("div", { className: "advisor-section" },
    React.createElement("div", { className: "section-head" },
      React.createElement("h2", null, "Advisor"),
      React.createElement("p", null, "Pattern-matching engine that finds wasteful tokens")
    ),
    React.createElement("div", { className: "advisor-total" },
      React.createElement("div", null,
        React.createElement("div", { className: "advisor-total-amount" }, `${fmtInt(totalTokensSaved)} tokens · ${fmtUSD(totalMonthlySavings)}/mo`),
        React.createElement("div", { className: "advisor-total-label" },
          `Potential savings at ${fmtInt(requestsPerDay)} requests/day (Sonnet 4.6 pricing)`)
      ),
      React.createElement("button", { className: "advisor-apply-all", onClick: handleApplyAll }, "Apply All Fixes")
    ),
    React.createElement("div", { className: "advisor-cards" },
      results.map(r =>
        React.createElement("div", { key: r.id, className: "advisor-card" },
          React.createElement("div", { className: "advisor-card-body" },
            React.createElement("div", { className: `advisor-card-category ${r.severity}` },
              `${r.category} · ${r.severity}`),
            r.matches.slice(0, 3).map((m, i) =>
              m.match && React.createElement("span", { key: i, className: "advisor-card-match" }, m.match)
            ),
            r.matchCount > 3 && React.createElement("span", { style: { fontSize: "11px", color: "var(--text-faint)" } }, ` +${r.matchCount - 3} more`),
            React.createElement("div", { className: "advisor-card-suggestion" }, r.suggestion),
            React.createElement("div", { className: "advisor-card-savings" },
              r.variableSavings ? "Variable savings" :
              `${r.totalTokensSaved} tokens saved · ${fmtUSD(r.totalTokensSaved * costPerToken)}/mo`)
          ),
          React.createElement("div", { className: "advisor-card-actions" },
            r.replacement != null && r.pattern &&
              React.createElement("button", { className: "advisor-apply-btn", onClick: () => handleApply(r) }, "Apply Fix")
          )
        )
      )
    )
  );
}

function App() {
  const [text, setText] = React.useState("");
  const [requestsPerDay, setRequestsPerDay] = React.useState(1000);
  const [outputTokens, setOutputTokens] = React.useState(500);
  const [cacheEnabled, setCacheEnabled] = React.useState(true);

  const counts = useMultiCount(text);

  return React.createElement(React.Fragment, null,
    // Top bar
    React.createElement("header", { className: "topbar" },
      React.createElement("div", { className: "brand" },
        React.createElement("div", { className: "brand-mark" }, "T"),
        React.createElement("span", { className: "brand-name" }, "TokenAdvisor")
      ),
      React.createElement("nav", { className: "topbar-links" },
        React.createElement("a", { href: "https://realaicost.com", target: "_blank", rel: "noopener" }, "RealAICost"),
        React.createElement("a", { href: "https://github.com/darkknight4563/tokenadvisor", target: "_blank", rel: "noopener" }, "GitHub")
      )
    ),

    React.createElement("main", { className: "page" },
      // Hero
      React.createElement("div", { className: "hero" },
        React.createElement("div", { className: "eyebrow" },
          React.createElement("span", { className: "dot" }),
          "Free · No signup · No data stored"
        ),
        React.createElement("h1", { className: "hero-title" },
          "See where your ", React.createElement("span", { className: "accent" }, "tokens"), " go.",
          React.createElement("br"),
          "Learn what to ", React.createElement("span", { className: "accent" }, "cut"), "."
        ),
        React.createElement("p", { className: "hero-sub" },
          "Paste your prompt. Compare token counts across Claude, GPT, and Gemini side-by-side. Get specific savings recommendations with dollar amounts at your volume."
        )
      ),

      // Prompt input
      React.createElement("div", { className: "prompt-panel" },
        React.createElement("div", { className: "panel-header" },
          React.createElement("span", null, "Your prompt"),
          React.createElement("span", { className: "char-count" }, text.length > 0 ? `${fmtInt(text.length)} chars` : "")
        ),
        React.createElement("div", { className: "prompt-body" },
          React.createElement("textarea", {
            id: "prompt-input",
            className: "token-input",
            placeholder: PLACEHOLDER_PROMPT,
            value: text,
            onChange: (e) => setText(e.target.value),
            maxLength: 10000,
          }),
          !text && React.createElement("button", {
            style: { marginTop: "8px", background: "transparent", border: "1px solid var(--border)", color: "var(--accent)",
              borderRadius: "6px", padding: "6px 14px", fontFamily: "var(--font-mono)", fontSize: "11px", cursor: "pointer" },
            onClick: () => setText(PLACEHOLDER_PROMPT),
          }, "Try example prompt")
        )
      ),

      // Section 1: Token view
      React.createElement("div", { className: "section-head" },
        React.createElement("h2", null, "Multi-Vendor Token View"),
        React.createElement("p", null, "Same text, different tokenizers — see the difference")
      ),
      React.createElement("div", { className: "token-columns" },
        React.createElement(TokenColumn, {
          provider: "openai", label: "OpenAI", models: "GPT-5.4 / GPT-5.5",
          count: counts.openai.tokens, source: counts.openai.source, pending: counts.openai.pending,
        },
          React.createElement(TokenVis, { tokenTexts: counts.tokenTexts })
        ),
        React.createElement(TokenColumn, {
          provider: "anthropic", label: "Anthropic", models: "Opus 4.7 / Sonnet 4.6",
          count: counts.anthropic.tokens, source: counts.anthropic.source, pending: counts.anthropic.pending,
          note: "Anthropic doesn’t publish per-token breakdown — count is from official API",
        }),
        React.createElement(TokenColumn, {
          provider: "google", label: "Google", models: "Gemini 2.5 Pro",
          count: counts.google.tokens, source: counts.google.source, pending: counts.google.pending,
          note: "Count from Google’s countTokens API",
        })
      ),
      React.createElement(ComparisonStrip, counts),

      // Section 2: Cost comparison
      React.createElement(CostSection, {
        inputTokens: counts.openai.tokens || counts.anthropic.tokens || 0,
        requestsPerDay, setRequestsPerDay,
        outputTokens, setOutputTokens,
        cacheEnabled, setCacheEnabled,
      }),

      // Section 3: Advisor
      React.createElement(AdvisorSection, {
        text, setText,
        inputTokens: counts.openai.tokens,
        requestsPerDay, outputTokens, cacheEnabled,
      })
    ),

    // Footer
    React.createElement("footer", { className: "footer" },
      React.createElement("span", null, "© 2025 TokenAdvisor · Built by ",
        React.createElement("a", { href: "https://realaicost.com", target: "_blank", rel: "noopener" }, "the RealAICost team")),
      React.createElement("span", null,
        React.createElement("a", { href: "https://realaicost.com", target: "_blank", rel: "noopener" }, "Full cost calculator →"))
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
