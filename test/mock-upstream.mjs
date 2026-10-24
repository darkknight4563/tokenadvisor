// Mock OpenAI + Anthropic upstream. Records every request it receives at GET /__log.
import http from "node:http";

const log = [];
const anthropicCached = new Set(); // system text that has had a cache write
const tok = (s) => Math.round((s || "").length / 3.5);

const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(e);
  res.end();
};

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(log));
    }
    if (req.url === "/__reset") { log.length = 0; anthropicCached.clear(); res.end("ok"); return; }
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    log.push({ url: req.url, method: req.method, headers: req.headers, body });
    const outTok = Number(req.headers["x-mock-out"] || 40);

    if (req.url === "/v1/chat/completions") {
      const sys = (body.messages || []).filter((m) => m.role === "system").map((m) => m.content).join("");
      const prompt = tok(JSON.stringify(body.messages));
      const cached = Number(req.headers["x-mock-cached"] || 0);
      const usage = { prompt_tokens: prompt, completion_tokens: outTok, total_tokens: prompt + outTok, prompt_tokens_details: { cached_tokens: cached } };
      if (body.stream) {
        const ev = [
          `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model + "-2026-01-01", choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] })}\n\n`,
          `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model + "-2026-01-01", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] })}\n\n`,
        ];
        if (body.stream_options?.include_usage) ev.push(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model, choices: [], usage })}\n\n`);
        ev.push("data: [DONE]\n\n");
        return sse(res, ev);
      }
      res.writeHead(200, { "content-type": "application/json", "x-request-id": "mock-123" });
      return res.end(JSON.stringify({ id: "c1", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "Hello" + sys.length }, finish_reason: "stop" }], usage }));
    }

    if (req.url === "/v1/responses") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "r1", object: "response", model: body.model, output: [], usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 100, total_tokens: 1300 } }));
    }

    if (req.url === "/v1/messages") {
      if (!req.headers["x-api-key"]) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "no key" } })); }
      const sysText = typeof body.system === "string" ? body.system : (body.system || []).map((b) => b.text).join("");
      const hasCC = JSON.stringify(body).includes("cache_control");
      const sysTok = tok(sysText);
      const msgTok = tok(JSON.stringify(body.messages));
      let usage;
      if (hasCC && anthropicCached.has(sysText)) usage = { input_tokens: msgTok, cache_read_input_tokens: sysTok, cache_creation_input_tokens: 0, output_tokens: outTok };
      else if (hasCC) { anthropicCached.add(sysText); usage = { input_tokens: msgTok, cache_read_input_tokens: 0, cache_creation_input_tokens: sysTok, output_tokens: outTok }; }
      else usage = { input_tokens: msgTok + sysTok, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: outTok };
      if (body.stream) {
        return sse(res, [
          `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", model: body.model, usage: { ...usage, output_tokens: 1 } } })}\n\n`,
          `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } })}\n\n`,
          `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outTok } })}\n\n`,
          `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
        ]);
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "m1", type: "message", model: body.model, content: [{ type: "text", text: "Hi" }], usage }));
    }

    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"data":[]}'); }
    res.writeHead(404); res.end("nope");
  });
}).listen(9999, "127.0.0.1", () => console.log("mock upstream on 9999"));
