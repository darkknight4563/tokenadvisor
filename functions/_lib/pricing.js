// Gateway pricing table. USD per 1M tokens.
// Anthropic: verified against platform.claude.com/docs/en/about-claude/pricing on 2026-10-24.
// OpenAI: from a third-party mirror (benchlm.ai, synced 2026-10-23) — re-check against
//   platform.openai.com/pricing before quoting numbers to a customer.
// cacheWrite = 5-minute cache write; cacheWrite1h = 1-hour write (Anthropic only).
// tierAbove / tier: pricing that applies to the WHOLE request once the prompt exceeds the threshold.

export const PRICING_AS_OF = "2026-10-24";

const A = (input, cacheWrite, cacheWrite1h, cacheRead, output, extra = {}) =>
  ({ provider: "anthropic", input, cacheWrite, cacheWrite1h, cacheRead, output, ...extra });
const O = (input, cacheRead, output, extra = {}) =>
  ({ provider: "openai", input, cacheWrite: null, cacheWrite1h: null, cacheRead, output, ...extra });

export const PRICES = {
  // ── Anthropic ──
  "claude-fable-5-1":  A(10, 12.5, 20, 0.25, 50, { tier: "frontier" }),
  "claude-mythos-5-1": A(10, 12.5, 20, 0.25, 50, { tier: "frontier" }),
  "claude-fable-5":    A(10, 12.5, 20, 1.00, 50, { tier: "frontier" }),
  "claude-mythos-5":   A(10, 12.5, 20, 1.00, 50, { tier: "frontier" }),
  "claude-opus-5-5":   A(4, 5, 8, 0.20, 20, { tier: "large" }),
  "claude-opus-5":     A(5, 6.25, 10, 0.50, 25, { tier: "large" }),
  "claude-opus-4-8":   A(5, 6.25, 10, 0.50, 25, { tier: "large" }),
  "claude-opus-4-7":   A(5, 6.25, 10, 0.50, 25, { tier: "large" }),
  "claude-opus-4-6":   A(5, 6.25, 10, 0.50, 25, { tier: "large" }),
  "claude-opus-4-5":   A(5, 6.25, 10, 0.50, 25, { tier: "large" }),
  "claude-opus-4-1":   A(15, 18.75, 30, 1.50, 75, { tier: "large" }),
  "claude-opus-4":     A(15, 18.75, 30, 1.50, 75, { tier: "large" }),
  "claude-sonnet-5-5": A(2, 2.5, 4, 0.10, 10, { tier: "mid" }),
  "claude-sonnet-5":   A(2, 2.5, 4, 0.20, 10, { tier: "mid" }),
  "claude-sonnet-4-6": A(3, 3.75, 6, 0.30, 15, { tier: "mid" }),
  "claude-sonnet-4-5": A(3, 3.75, 6, 0.30, 15, { tier: "mid" }),
  "claude-sonnet-4":   A(3, 3.75, 6, 0.30, 15, { tier: "mid" }),
  "claude-haiku-5-5":  A(0.10, 0.125, 0.20, 0.01, 0.50, {
    tier: "small",
    tierAbove: 100_000,
    above: { input: 0.50, cacheWrite: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.50 },
  }),
  "claude-haiku-4-5":  A(1, 1.25, 2, 0.10, 5, { tier: "small" }),
  "claude-3-5-haiku":  A(0.80, 1, 1.6, 0.08, 4, { tier: "small" }),

  // ── OpenAI ──
  "gpt-6-astra":   O(10, 1, 50, { tier: "frontier" }),
  "gpt-6-1-sol":   O(2, 0.10, 10, { tier: "mid" }),
  "gpt-6-sol":     O(2, 0.20, 10, { tier: "mid" }),
  "gpt-6-luna":    O(0.10, 0.01, 0.50, { tier: "small" }),
  "gpt-5-6-sol":   O(4, 0.40, 20, { tier: "large", note: "promo rate through at least 2026-11-21" }),
  "gpt-5-6-terra": O(2, 0.20, 12, { tier: "mid" }),
  "gpt-5-6-luna":  O(0.20, 0.02, 1.20, { tier: "small" }),
  "gpt-5-5-pro":   O(30, null, 180, { tier: "frontier" }),
  "gpt-5-5":       O(5, 0.50, 30, { tier: "large" }),
  "gpt-5-4-pro":   O(30, null, 180, { tier: "frontier" }),
  "gpt-5-4":       O(2.50, 0.25, 15, { tier: "mid" }),
  "gpt-5-4-mini":  O(0.75, 0.075, 4.50, { tier: "small" }),
  "gpt-5-4-nano":  O(0.20, 0.02, 1.25, { tier: "small" }),
  "gpt-5":         O(1.25, 0.125, 10, { tier: "mid" }),
  "gpt-5-mini":    O(0.25, 0.025, 2, { tier: "small" }),
  "gpt-5-nano":    O(0.05, 0.005, 0.40, { tier: "small" }),
  "gpt-4-1":       O(2, 0.50, 8, { tier: "mid" }),
  "gpt-4-1-mini":  O(0.40, 0.10, 1.60, { tier: "small" }),
  "gpt-4-1-nano":  O(0.10, 0.025, 0.40, { tier: "small" }),
  "gpt-4o":        O(2.50, 1.25, 10, { tier: "mid" }),
  "gpt-4o-mini":   O(0.15, 0.075, 0.60, { tier: "small" }),
  "o3":            O(2, 0.50, 8, { tier: "mid" }),
  "o4-mini":       O(1.10, 0.275, 4.40, { tier: "small" }),
  "text-embedding-3-small": O(0.02, null, 0, { tier: "embed" }),
  "text-embedding-3-large": O(0.13, null, 0, { tier: "embed" }),
};

// Cheaper same-provider model to suggest for short, simple calls.
export const DOWNGRADE = {
  "claude-fable-5-1": "claude-opus-5-5",
  "claude-mythos-5-1": "claude-opus-5-5",
  "claude-fable-5": "claude-opus-5-5",
  "claude-mythos-5": "claude-opus-5-5",
  "claude-opus-5-5": "claude-sonnet-5-5",
  "claude-opus-5": "claude-sonnet-5-5",
  "claude-opus-4-8": "claude-sonnet-5-5",
  "claude-opus-4-7": "claude-sonnet-5-5",
  "claude-opus-4-6": "claude-sonnet-5-5",
  "claude-opus-4-5": "claude-sonnet-5-5",
  "claude-opus-4-1": "claude-sonnet-5-5",
  "claude-opus-4": "claude-sonnet-5-5",
  "claude-sonnet-5-5": "claude-haiku-5-5",
  "claude-sonnet-5": "claude-haiku-5-5",
  "claude-sonnet-4-6": "claude-haiku-5-5",
  "claude-sonnet-4-5": "claude-haiku-5-5",
  "claude-sonnet-4": "claude-haiku-5-5",
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-3-5-haiku": "claude-haiku-5-5",
  "gpt-6-astra": "gpt-6-1-sol",
  "gpt-5-5-pro": "gpt-6-1-sol",
  "gpt-5-4-pro": "gpt-6-1-sol",
  "gpt-5-5": "gpt-6-1-sol",
  "gpt-5-6-sol": "gpt-6-1-sol",
  "gpt-5-4": "gpt-6-1-sol",
  "gpt-6-1-sol": "gpt-6-luna",
  "gpt-6-sol": "gpt-6-luna",
  "gpt-5-6-terra": "gpt-6-luna",
  "gpt-5": "gpt-6-luna",
  "gpt-4-1": "gpt-6-luna",
  "gpt-4o": "gpt-6-luna",
  "o3": "gpt-6-1-sol",
};

// "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"; "gpt-5.4-mini-2026-03-17" → "gpt-5-4-mini";
// "claude-3-5-haiku-latest" → "claude-3-5-haiku". Exact match only after normalising —
// an unknown variant is reported as unpriced rather than silently priced as its base model.
export function normalizeModel(raw) {
  if (!raw || typeof raw !== "string") return null;
  let m = raw.trim().toLowerCase();
  if (m.includes("/")) m = m.split("/").pop(); // "openai/gpt-5.4" style ids
  m = m.replace(/\./g, "-");
  m = m.replace(/-latest$/, "");
  m = m.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
  return m;
}

export function priceFor(rawModel) {
  const id = normalizeModel(rawModel);
  return id && PRICES[id] ? { id, ...PRICES[id] } : null;
}

// usage = { input, cacheRead, cacheWrite, cacheWrite1h, output } — `input` is UNCACHED input only.
export function costOf(price, u) {
  if (!price) return null;
  const promptTotal = u.input + u.cacheRead + u.cacheWrite + u.cacheWrite1h;
  const p = price.tierAbove && promptTotal > price.tierAbove ? { ...price, ...price.above } : price;
  const cw = p.cacheWrite ?? p.input;
  const cw1h = p.cacheWrite1h ?? cw;
  const cr = p.cacheRead ?? p.input;
  const usd =
    u.input * p.input +
    u.cacheWrite * cw +
    u.cacheWrite1h * cw1h +
    u.cacheRead * cr +
    u.output * p.output;
  return usd / 1e6;
}

// What the same token usage would have cost with no prompt caching at all.
export function uncachedCostOf(price, u) {
  if (!price) return null;
  return costOf(price, {
    input: u.input + u.cacheRead + u.cacheWrite + u.cacheWrite1h,
    cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0,
    output: u.output,
  });
}
