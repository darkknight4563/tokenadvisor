const MODELS = [
  { id: "sonnet-4-6", provider: "Anthropic", name: "Claude Sonnet 4.6",
    input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75, ctx: 1000000,
    tokenizer: "claude", apiModel: "sonnet-4-6" },
  { id: "opus-4-7", provider: "Anthropic", name: "Claude Opus 4.7",
    input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25, ctx: 1000000,
    tokenizer: "claude", apiModel: "opus-4-7" },
  { id: "haiku-4-5", provider: "Anthropic", name: "Claude Haiku 4.5",
    input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25, ctx: 200000,
    tokenizer: "claude", apiModel: "haiku-4-5" },
  { id: "gpt-5-4", provider: "OpenAI", name: "GPT-5.4",
    input: 2.50, output: 15, cacheRead: 0.25, ctx: 1000000,
    tokenizer: "o200k", encoding: "o200k_base" },
  { id: "gpt-5-5", provider: "OpenAI", name: "GPT-5.5",
    input: 5, output: 30, cacheRead: 0.50, ctx: 1000000,
    tokenizer: "o200k", encoding: "o200k_base" },
  { id: "gemini-2-5-pro", provider: "Google", name: "Gemini 2.5 Pro",
    input: 1.25, output: 10, cacheRead: 0.125, ctx: 2000000,
    tokenizer: "gemini", apiModel: "gemini-2-5-pro" },
];

const TOKEN_COLUMN_MODELS = {
  openai:    { primary: "gpt-5-4", secondary: "gpt-5-5", label: "OpenAI", encoding: "o200k_base" },
  anthropic: { primary: "sonnet-4-6", secondary: "opus-4-7", label: "Anthropic", apiModel: "sonnet-4-6" },
  google:    { primary: "gemini-2-5-pro", secondary: null, label: "Google", apiModel: "gemini-2-5-pro" },
};

function computeMonthlyCost({ model, inputTokens, outputTokens, requestsPerDay, cachePct }) {
  const cacheFrac = Math.max(0, Math.min(1, (cachePct || 0) / 100));
  const hasCacheRead = model.cacheRead != null;
  const effCache = hasCacheRead ? cacheFrac : 0;

  const fullInput = inputTokens * (1 - effCache);
  const cachedInput = inputTokens * effCache;

  const inputCost = (fullInput / 1e6) * model.input;
  const cacheCost = (cachedInput / 1e6) * (model.cacheRead ?? model.input);
  const outputCost = (outputTokens / 1e6) * model.output;

  const perRequest = inputCost + cacheCost + outputCost;
  return perRequest * requestsPerDay * 30;
}

function fmtUSD(n) {
  if (!isFinite(n) || n === 0) return "$0.00";
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 10) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}

function fmtInt(n) {
  return (n || 0).toLocaleString("en-US");
}

Object.assign(window, { MODELS, TOKEN_COLUMN_MODELS, computeMonthlyCost, fmtUSD, fmtInt });
