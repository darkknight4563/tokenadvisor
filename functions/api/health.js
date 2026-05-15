export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    routes_ok: true,
    bindings: {
      anthropic: !!env.ANTHROPIC_API_KEY,
      google: !!env.GOOGLE_API_KEY,
    },
    runtime: "cloudflare-pages-functions",
    version: "v0.1.0",
    timestamp: new Date().toISOString(),
  }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
