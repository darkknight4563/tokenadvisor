# TokenAdvisor cost gateway

One-line, bring-your-own-key proxy for OpenAI and Anthropic. It prices every call from the
tokens the provider actually billed, finds savings with dollar figures, and can auto-apply
Claude prompt caching with savings measured net of cache-write costs.

```
OpenAI:    base_url = https://tokenadvisor.dev/gw/<project_key>/openai/v1
Anthropic: base_url = https://tokenadvisor.dev/gw/<project_key>/anthropic
Optional:  header x-ta-feature: <name>   → spend split by feature
```

## Go live (about 5 minutes, Cloudflare dashboard)

1. **Workers & Pages → D1 → Create database**, name it `tokenadvisor-gateway`.
2. **Workers & Pages → tokenadvisor (Pages project) → Settings → Bindings → Add → D1 database**.
   Variable name **`DB`**, database `tokenadvisor-gateway`. Add it for **Production and Preview**.
   Tables are created automatically on first request; no migration step.
3. *(Optional)* **Settings → Variables and secrets**: `RESEND_API_KEY` + `NOTIFY_EMAIL` to get an
   email for every signup (`NOTIFY_FROM` to change the sender).
4. Redeploy the `gateway` branch preview, then check `https://<preview>.tokenadvisor.pages.dev/api/health`
   shows `"gateway_db": true`. Sign up on the preview homepage and send one real call through it.
5. Merge the PR. Production deploys on push to `main`.

Without the `DB` binding the site still works: the analyzer is unaffected, the gateway proxies
without logging, and signup returns "not open yet".

## What's stored

Per call: timestamp, provider, endpoint, model, feature tag, status, latency, token counts
(input / cache read / cache write / output), cost, auto-cache savings, and truncated SHA-256 hashes
of the system prompt + tools and of the request body. **Never prompt or completion text, never the
customer's provider key.** Rows older than 90 days are deleted.

## How it behaves

- **Fails open**: if storage or our own logic errors, the request is forwarded unmodified.
- **Byte-for-byte passthrough**, with two exceptions:
  - OpenAI streamed chat without `stream_options.include_usage`: the gateway adds it (needed to
    measure cost) and strips the extra usage chunk back out of the client's stream.
  - Anthropic with auto-caching on: one `cache_control` breakpoint is added to the system prompt,
    only if the same tools+system prefix was seen in the last 5 minutes and the request has no
    `cache_control` of its own.
- Only `api.openai.com` and `api.anthropic.com` are reachable (fixed hosts, `v1/` paths only).
- Logged endpoints: OpenAI `chat/completions`, `responses`, `embeddings`; Anthropic `messages`.
  Everything else (e.g. `GET /v1/models`) is passed through unlogged.

## Recommendations engine (`functions/_lib/insights.js`)

| Rule | Trigger | $ basis |
|---|---|---|
| Duplicate requests | identical body (ignoring stream flags) sent more than once | measured |
| Claude prompt caching | ≥4k-char prefix repeated within 5 min, never cached | estimate, net of write premium |
| Unstable prefix | >80% of long-prefix calls have a never-seen prefix (≥20 calls) | estimate, assumes half is static |
| Model right-sizing | ≥20 calls, avg output ≤300, avg prompt ≤6k tokens, cheaper model in `DOWNGRADE` | estimate, same tokens |

Monthly figures project the 30-day window from the days actually observed.

## Pricing data

`functions/_lib/pricing.js`. Anthropic verified against the official pricing page on 2026-10-24.
**OpenAI prices come from a third-party mirror (synced 2026-10-23): check them against
platform.openai.com/pricing before quoting numbers to a customer.** Unknown model IDs are logged
as "unpriced" instead of guessed.

## Local test

```
node test/mock-upstream.mjs &
npx wrangler pages dev . --d1 DB=gwtest \
  --binding UPSTREAM_OPENAI=http://127.0.0.1:9999 --binding UPSTREAM_ANTHROPIC=http://127.0.0.1:9999
node test/e2e.mjs        # 41 checks: passthrough, streaming, cost math, recs, auto-cache
```

`UPSTREAM_*` overrides exist only for this; leave them unset in Cloudflare.
