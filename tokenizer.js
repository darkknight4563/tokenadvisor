const FALLBACK_RATIOS = { default: 3.5, code: 2.8 };

function isCodeHeavy(text) {
  if (!text) return false;
  if (/```/.test(text)) return true;
  const nonAlpha = (text.match(/[^a-zA-Z\s]/g) || []).length;
  return nonAlpha / text.length > 0.20;
}

function charApprox(text, tokenizerId) {
  if (!text) return 0;
  const base = isCodeHeavy(text) ? FALLBACK_RATIOS.code : FALLBACK_RATIOS.default;
  let ratio = base;
  if (tokenizerId === "gemini") ratio = base * (4.0 / 3.5);
  else if (tokenizerId === "o200k") ratio = base * (3.8 / 3.5);
  return Math.max(1, Math.round(text.length / ratio));
}

let tiktokenModulePromise = null;
const encoderCache = new Map();

function loadTiktoken() {
  if (!tiktokenModulePromise) {
    tiktokenModulePromise = window.__loadTiktoken().catch(err => {
      tiktokenModulePromise = null;
      throw err;
    });
  }
  return tiktokenModulePromise;
}

async function getEncoder(encodingName) {
  if (encoderCache.has(encodingName)) return encoderCache.get(encodingName);
  const mod = await loadTiktoken();
  const enc = mod.getEncoding(encodingName);
  encoderCache.set(encodingName, enc);
  return enc;
}

async function countOpenAI(text, encodingName) {
  if (!text) return { tokens: 0, source: "empty" };
  try {
    const enc = await getEncoder(encodingName);
    const encoded = enc.encode(text);
    return { tokens: encoded.length, source: "tiktoken", tokenIds: encoded };
  } catch (e) {
    return { tokens: charApprox(text, "o200k"), source: "fallback", error: e.message };
  }
}

async function countAPI(provider, modelId, text) {
  if (!text) return { tokens: 0, source: "empty" };
  const endpoint = provider === "google" ? "/api/count-tokens-gemini" : "/api/count-tokens";
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: text }] }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.fallback) throw new Error(data.error || "fallback");
    return { tokens: data.input_tokens, source: "api" };
  } catch (e) {
    const tokenizerId = provider === "google" ? "gemini" : "claude";
    return { tokens: charApprox(text, tokenizerId), source: "fallback", error: e.message };
  }
}

function decodeTokenTexts(encoded, encoder) {
  const result = [];
  for (let i = 0; i < encoded.length; i++) {
    try {
      const text = encoder.decode([encoded[i]]);
      result.push(typeof text === "string" ? text : new TextDecoder("utf-8", { fatal: false }).decode(text));
    } catch {
      result.push("?");
    }
  }
  return result;
}

async function getTokenTexts(text, encodingName) {
  try {
    const enc = await getEncoder(encodingName);
    const encoded = enc.encode(text);
    return decodeTokenTexts(encoded, enc);
  } catch {
    return null;
  }
}

function useMultiCount(text, debounceMs = 300) {
  const [state, setState] = React.useState({
    openai: { tokens: 0, source: "empty", pending: false },
    anthropic: { tokens: 0, source: "empty", pending: false },
    google: { tokens: 0, source: "empty", pending: false },
    tokenTexts: null,
  });
  const reqRef = React.useRef(0);

  React.useEffect(() => {
    if (!text) {
      setState({
        openai: { tokens: 0, source: "empty", pending: false },
        anthropic: { tokens: 0, source: "empty", pending: false },
        google: { tokens: 0, source: "empty", pending: false },
        tokenTexts: null,
      });
      return;
    }

    const approxOpenAI = charApprox(text, "o200k");
    const approxClaude = charApprox(text, "claude");
    const approxGemini = charApprox(text, "gemini");

    setState({
      openai: { tokens: approxOpenAI, source: "pending", pending: true },
      anthropic: { tokens: approxClaude, source: "pending", pending: true },
      google: { tokens: approxGemini, source: "pending", pending: true },
      tokenTexts: null,
    });

    const myReq = ++reqRef.current;
    const t = setTimeout(async () => {
      const [oai, ant, ggl, texts] = await Promise.all([
        countOpenAI(text, "o200k_base"),
        countAPI("anthropic", "sonnet-4-6", text),
        countAPI("google", "gemini-2-5-pro", text),
        getTokenTexts(text, "o200k_base"),
      ]);
      if (reqRef.current !== myReq) return;
      setState({
        openai: { ...oai, pending: false },
        anthropic: { ...ant, pending: false },
        google: { ...ggl, pending: false },
        tokenTexts: texts,
      });
    }, debounceMs);

    return () => clearTimeout(t);
  }, [text, debounceMs]);

  return state;
}

Object.assign(window, {
  Tokenizer: { countOpenAI, countAPI, charApprox, getTokenTexts, encoderCache },
  useMultiCount,
});
