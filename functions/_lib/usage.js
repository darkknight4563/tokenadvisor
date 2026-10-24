// Normalise provider usage objects to { input (uncached), cacheRead, cacheWrite, cacheWrite1h, output }.

const n = (v) => (Number.isFinite(v) ? v : 0);

export function emptyUsage() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, seen: false };
}

export function fromAnthropic(u) {
  if (!u || typeof u !== "object") return null;
  let cw5 = n(u.cache_creation_input_tokens);
  let cw1h = 0;
  if (u.cache_creation && typeof u.cache_creation === "object") {
    cw5 = n(u.cache_creation.ephemeral_5m_input_tokens);
    cw1h = n(u.cache_creation.ephemeral_1h_input_tokens);
  }
  return {
    input: n(u.input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: cw5,
    cacheWrite1h: cw1h,
    output: n(u.output_tokens),
  };
}

export function fromOpenAI(u) {
  if (!u || typeof u !== "object") return null;
  // Chat Completions / Embeddings: prompt_tokens (includes cached) + completion_tokens.
  // Responses API: input_tokens (includes cached) + output_tokens.
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  const cached =
    u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  return {
    input: Math.max(0, n(prompt) - n(cached)),
    cacheRead: n(cached),
    cacheWrite: 0,
    cacheWrite1h: 0,
    output: n(output),
  };
}

// Merge partial usage (streaming events report pieces at different times). Take the max per field,
// since providers report cumulative values.
function merge(acc, part) {
  if (!part) return;
  acc.seen = true;
  for (const k of ["input", "cacheRead", "cacheWrite", "cacheWrite1h", "output"]) {
    acc[k] = Math.max(acc[k], part[k] || 0);
  }
}

export function usageFromJson(provider, body) {
  const acc = emptyUsage();
  if (!body || typeof body !== "object") return acc;
  merge(acc, provider === "anthropic" ? fromAnthropic(body.usage) : fromOpenAI(body.usage));
  if (!acc.seen && body.response?.usage) merge(acc, fromOpenAI(body.response.usage));
  return acc;
}

// Feed one parsed SSE `data:` JSON object into the accumulator. Returns true when the event is an
// OpenAI usage-only chunk (choices: [] + usage) — the caller drops it if the gateway injected
// stream_options.include_usage, so client code that does chunk.choices[0] never sees it.
export function feedStreamEvent(provider, acc, data, meta) {
  if (!data || typeof data !== "object") return false;
  if (data.model && !meta.model) meta.model = data.model;
  if (provider === "anthropic") {
    if (data.type === "message_start" && data.message) {
      if (data.message.model) meta.model = data.message.model;
      merge(acc, fromAnthropic(data.message.usage));
    } else if (data.type === "message_delta" && data.usage) {
      merge(acc, fromAnthropic(data.usage));
    }
    return false;
  }
  // OpenAI
  if (data.type === "response.completed" && data.response) {
    if (data.response.model) meta.model = data.response.model;
    merge(acc, fromOpenAI(data.response.usage));
    return false;
  }
  if (data.usage) {
    merge(acc, fromOpenAI(data.usage));
    return Array.isArray(data.choices) && data.choices.length === 0;
  }
  return false;
}

// TransformStream that passes SSE bytes through untouched (event by event), extracts usage, and
// optionally drops the usage-only chunk. `onDone(acc, meta)` fires once when the stream ends.
export function sseTap(provider, { dropUsageChunk, onDone }) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const acc = emptyUsage();
  const meta = { model: null };
  let buf = "";
  let finished = false;

  const handleEvent = (raw) => {
    // raw = event text without the trailing blank line
    let drop = false;
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const isUsageOnly = feedStreamEvent(provider, acc, JSON.parse(payload), meta);
        if (isUsageOnly && dropUsageChunk) drop = true;
      } catch { /* not JSON — pass through */ }
    }
    return drop;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    try { onDone(acc, meta); } catch { /* never break the client stream */ }
  };

  return new TransformStream({
    transform(chunk, controller) {
      buf += dec.decode(chunk, { stream: true });
      // Events are separated by a blank line (\n\n or \r\n\r\n).
      let m;
      while ((m = buf.match(/\r?\n\r?\n/))) {
        const raw = buf.slice(0, m.index);
        const sep = m[0];
        buf = buf.slice(m.index + sep.length);
        if (!handleEvent(raw)) controller.enqueue(enc.encode(raw + sep));
      }
    },
    flush(controller) {
      buf += dec.decode();
      if (buf.length) {
        if (!handleEvent(buf)) controller.enqueue(enc.encode(buf));
        buf = "";
      }
      finish();
    },
  });
}
