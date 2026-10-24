// Gateway landing section (plain React.createElement, no build step — same as the rest of the site).
(() => {
const h = React.createElement;

function CopyRow({ value }) {
  const [copied, setCopied] = React.useState(false);
  return h("div", { className: "copyrow" },
    h("code", null, value),
    h("button", {
      onClick: () => {
        navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
      },
    }, copied ? "Copied" : "Copy")
  );
}

function SignupForm() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/signup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Signup failed (HTTP ${r.status})`);
      setResult(j);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return h("div", { className: "signup-result" },
      h("h3", null, "You're set up. Change one line and make a call."),
      h("p", { className: "warn" }, "Save your dashboard link now. It's your login, and we can't show it again."),
      h("div", { className: "kpi-label", style: { marginTop: 14 } }, "Dashboard (private)"),
      h(CopyRow, { value: result.dashboard_url }),
      h("div", { className: "kpi-label", style: { marginTop: 14 } }, "OpenAI base_url"),
      h(CopyRow, { value: result.base_urls.openai }),
      h("div", { className: "kpi-label", style: { marginTop: 14 } }, "Anthropic base_url"),
      h(CopyRow, { value: result.base_urls.anthropic }),
      h("p", { style: { marginTop: 16 } }, h("a", { href: result.dashboard_url }, "Open your dashboard →"))
    );
  }

  return h(React.Fragment, null,
    h("form", { className: "signup", onSubmit: submit },
      h("input", {
        type: "email", required: true, placeholder: "you@company.com", value: email,
        onChange: (e) => setEmail(e.target.value), "aria-label": "Work email",
      }),
      h("button", { className: "btn-primary", type: "submit", disabled: busy }, busy ? "Creating…" : "Get my gateway URL")
    ),
    h("div", { className: "signup-error", role: "alert" }, error),
    h("div", { className: "signup-note" }, "No card. Your provider keys stay yours. Remove the base_url line to leave.")
  );
}

function GatewaySection() {
  return h(React.Fragment, null,
    h("section", { className: "gw-hero", id: "gateway" },
      h("div", { className: "eyebrow" }, h("span", { className: "dot" }), "Cost gateway for OpenAI + Anthropic · Free in beta"),
      h("h1", { className: "hero-title" },
        "Cut your LLM bill.", h("br"),
        "Change ", h("span", { className: "accent" }, "one line"), "."
      ),
      h("p", { className: "hero-sub" },
        "Point your existing SDK at TokenAdvisor. We measure what every call really costs, show you which features burn money, and switch on the fixes that are safe to automate, like prompt caching."
      ),
      h("div", { className: "gw-proof" },
        h("span", null, "Bring your own API key"),
        h("span", null, "Prompts never stored"),
        h("span", null, "Streaming supported"),
        h("span", null, "Fails open: calls still go through")
      ),
      h("div", { className: "diffbox" },
        h("div", { className: "snip-head" }, h("span", null, "your_app.py"), h("span", null, "the whole integration")),
        h("pre", null,
          h("span", { className: "diff-ctx" }, "client = OpenAI(\n"),
          h("span", { className: "diff-add" }, "+   base_url=\"https://tokenadvisor.dev/gw/<your-key>/openai/v1\",\n"),
          h("span", { className: "diff-ctx" }, ")  # OPENAI_API_KEY unchanged, nothing else to install")
        )
      ),
      h(SignupForm)
    ),

    h("section", { className: "gw-steps" },
      h("div", { className: "gw-step" },
        h("div", { className: "num" }, "01 · SEE"),
        h("h3", null, "Real spend, per feature"),
        h("p", null, "Every call priced from the tokens the provider actually billed, including cache reads and writes. Tag calls with one header to split spend by feature.")
      ),
      h("div", { className: "gw-step" },
        h("div", { className: "num" }, "02 · CUT"),
        h("h3", null, "Fixes with a dollar figure"),
        h("p", null, "Repeated prompts that never get cached, duplicate calls, system prompts that change on every request, flagship models doing one-line answers. Each comes with its monthly cost.")
      ),
      h("div", { className: "gw-step" },
        h("div", { className: "num" }, "03 · AUTOMATE"),
        h("h3", null, "Savings you can verify"),
        h("p", null, "Turn on auto-caching for Claude and the gateway adds cache breakpoints only where a prefix is actually being reused. Savings are measured from billed tokens, net of cache-write costs.")
      )
    ),

    h("section", { className: "gw-pricing", id: "pricing" },
      h("h2", null, "Pricing that only works if we work"),
      h("div", { className: "big" }, "25% of verified savings"),
      h("p", null, "Free during the beta. After that you pay a quarter of what auto-optimisation saves you, as measured on your own dashboard. Recommendations you apply yourself are free. If we save you nothing, you pay nothing."),
      h("p", null, "Spending $1k+/month on LLM APIs? ",
        h("a", { href: "mailto:emadiali83@gmail.com?subject=TokenAdvisor%20gateway%20founding%20team" }, "Talk to the founder"),
        " about a founding-team setup.")
    ),

    h("div", { className: "tool-divider" },
      h("h2", null, "Free tool: analyze a single prompt"),
      h("p", null, "No signup. Paste a prompt to compare token counts and costs across Claude, GPT and Gemini.")
    )
  );
}

window.GatewaySection = GatewaySection;
})();
