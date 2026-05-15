const ADVISOR_RULES = [
  // --- Politeness padding ---
  { id: "polite-please", category: "Politeness padding", severity: "low",
    pattern: /\bplease\b(?!\s+(note|ensure|make|provide|follow))/gi,
    suggestion: "Remove filler \"please\" — models don't respond better to politeness tokens.",
    replacement: "", tokensSaved: 1 },
  { id: "polite-could-you", category: "Politeness padding", severity: "low",
    pattern: /\bcould you possibly\b/gi,
    suggestion: "Replace with direct instruction.",
    replacement: "Please", tokensSaved: 2 },
  { id: "polite-thank-you", category: "Politeness padding", severity: "low",
    pattern: /\bthank you for\b/gi,
    suggestion: "Remove — has no effect on output quality.",
    replacement: "", tokensSaved: 3 },
  { id: "polite-appreciate", category: "Politeness padding", severity: "low",
    pattern: /\bI appreciate it if you would\b/gi,
    suggestion: "Remove — polite filler that adds tokens without changing behavior.",
    replacement: "", tokensSaved: 5 },
  { id: "polite-dont-mind", category: "Politeness padding", severity: "low",
    pattern: /\bif you don'?t mind\b/gi,
    suggestion: "Remove — the model always complies regardless.",
    replacement: "", tokensSaved: 4 },

  // --- Verbose phrases ---
  { id: "verbose-would-like", category: "Verbose phrases", severity: "medium",
    pattern: /\bI would like you to\b/gi,
    suggestion: "Remove — just give the instruction directly.",
    replacement: "", tokensSaved: 5 },
  { id: "verbose-ensure-that", category: "Verbose phrases", severity: "low",
    pattern: /\bensure that you\b/gi,
    suggestion: "Simplify to \"ensure\".",
    replacement: "ensure", tokensSaved: 2 },
  { id: "verbose-make-sure", category: "Verbose phrases", severity: "low",
    pattern: /\bmake sure to\b/gi,
    suggestion: "Remove — the instruction that follows is sufficient.",
    replacement: "", tokensSaved: 3 },
  { id: "verbose-try-to", category: "Verbose phrases", severity: "low",
    pattern: /\btry to\b(?=\s+[a-z])/gi,
    suggestion: "Remove — just state the action directly.",
    replacement: "", tokensSaved: 2 },
  { id: "verbose-important-that", category: "Verbose phrases", severity: "medium",
    pattern: /\bit is important that\b/gi,
    suggestion: "Remove — if it's in the prompt, the model treats it as important.",
    replacement: "", tokensSaved: 4 },
  { id: "verbose-please-note", category: "Verbose phrases", severity: "low",
    pattern: /\bplease note that\b/gi,
    suggestion: "Remove — just state the fact.",
    replacement: "", tokensSaved: 3 },
  { id: "verbose-keep-in-mind", category: "Verbose phrases", severity: "low",
    pattern: /\bkeep in mind that\b/gi,
    suggestion: "Remove — state the constraint directly.",
    replacement: "", tokensSaved: 4 },
  { id: "verbose-previously", category: "Verbose phrases", severity: "low",
    pattern: /\bas previously mentioned\b/gi,
    suggestion: "Remove — the model has the full context already.",
    replacement: "", tokensSaved: 3 },

  // --- Redundant intensifiers ---
  { id: "intensifier-analyze", category: "Redundant intensifiers", severity: "medium",
    pattern: /\bcarefully analyze and thoroughly review\b/gi,
    suggestion: "Simplify to \"analyze\" — stacking verbs doesn't improve depth.",
    replacement: "analyze", tokensSaved: 5 },
  { id: "intensifier-comprehensive", category: "Redundant intensifiers", severity: "low",
    pattern: /\bcomprehensive and detailed\b/gi,
    suggestion: "Use just \"detailed\" — they're synonyms here.",
    replacement: "detailed", tokensSaved: 2 },
  { id: "intensifier-step-detail", category: "Redundant intensifiers", severity: "low",
    pattern: /\bstep by step in detail\b/gi,
    suggestion: "Use just \"step by step\".",
    replacement: "step by step", tokensSaved: 3 },
  { id: "intensifier-important-critical", category: "Redundant intensifiers", severity: "low",
    pattern: /\bvery important and critical\b/gi,
    suggestion: "Use just \"critical\".",
    replacement: "critical", tokensSaved: 3 },

  // --- Instructional bloat ---
  { id: "bloat-ai-assistant", category: "Instructional bloat", severity: "high",
    pattern: /\bYou are an AI assistant\b/gi,
    suggestion: "Remove — the model knows what it is. Use a role description instead if needed.",
    replacement: "", tokensSaved: 4 },
  { id: "bloat-your-task", category: "Instructional bloat", severity: "medium",
    pattern: /\bYour task is to\b/gi,
    suggestion: "Remove — just state the task.",
    replacement: "", tokensSaved: 4 },
  { id: "bloat-follow-instructions", category: "Instructional bloat", severity: "medium",
    pattern: /\bPlease follow these instructions:?\b/gi,
    suggestion: "Remove — the numbered list speaks for itself.",
    replacement: "", tokensSaved: 5 },
  { id: "bloat-before-start", category: "Instructional bloat", severity: "medium",
    pattern: /\bBefore you start,?\s*let me explain\b/gi,
    suggestion: "Remove preamble — get to the point.",
    replacement: "", tokensSaved: 6 },

  // --- Structural issues ---
  { id: "struct-many-examples", category: "Structural issues", severity: "high",
    pattern: null,
    detect: (text) => {
      const exampleBlocks = text.match(/(?:example|e\.g\.|for instance|such as)[:\s]/gi) || [];
      const numberedExamples = text.match(/(?:^|\n)\s*(?:example\s*)?#?\d+[.:)\s]/gm) || [];
      const count = Math.max(exampleBlocks.length, numberedExamples.length);
      if (count >= 5) {
        return [{ match: `${count} example blocks detected`, index: 0, length: 0 }];
      }
      return [];
    },
    suggestion: "You have 5+ examples. Consider reducing to 2-3 — diminishing returns after that.",
    replacement: null, tokensSaved: 0, variableSavings: true },
  { id: "struct-no-format", category: "Structural issues", severity: "medium",
    pattern: null,
    detect: (text) => {
      const hasFormat = /(?:format|output|respond|return)\s*(?:as|in|with|:)/i.test(text) ||
                        /<[a-z_]+>/.test(text) || /```/.test(text) || /\bjson\b/i.test(text);
      if (!hasFormat && text.length > 100) {
        return [{ match: "No output format specified", index: 0, length: 0 }];
      }
      return [];
    },
    suggestion: "Add an output format (JSON, XML tags, markdown) to reduce rambling output tokens.",
    replacement: null, tokensSaved: 0, variableSavings: true },
  { id: "struct-repeated", category: "Structural issues", severity: "high",
    pattern: null,
    detect: (text) => {
      const sentences = text.split(/[.!?\n]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);
      const seen = new Map();
      const dupes = [];
      for (const s of sentences) {
        const key = s.replace(/\s+/g, " ");
        if (seen.has(key)) {
          dupes.push({ match: `Repeated: "${s.slice(0, 60)}..."`, index: 0, length: 0 });
        }
        seen.set(key, true);
      }
      return dupes;
    },
    suggestion: "Remove duplicate instructions — restating doesn't help, it just costs tokens.",
    replacement: null, tokensSaved: 0, variableSavings: true },
  { id: "struct-long-preamble", category: "Structural issues", severity: "medium",
    pattern: null,
    detect: (text) => {
      const firstQuestion = text.search(/[?]|(?:^|\n)\s*(?:\d+\.|[-*])\s/m);
      if (firstQuestion < 0) return [];
      const preamble = text.slice(0, firstQuestion);
      const preambleTokens = Math.round(preamble.length / 3.5);
      if (preambleTokens > 50) {
        return [{ match: `~${preambleTokens} tokens before first instruction`, index: 0, length: firstQuestion }];
      }
      return [];
    },
    suggestion: "Long preamble before the actual question. Consider trimming or moving context to the end.",
    replacement: null, tokensSaved: 0, variableSavings: true },
];

function runAdvisor(text) {
  if (!text || text.length < 10) return [];

  const results = [];
  for (const rule of ADVISOR_RULES) {
    let matches = [];

    if (rule.pattern) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ match: m[0], index: m.index, length: m[0].length });
      }
    } else if (rule.detect) {
      matches = rule.detect(text);
    }

    if (matches.length > 0) {
      const totalTokens = rule.variableSavings
        ? matches.reduce((sum, m) => sum + Math.round(m.length / 3.5), 0)
        : rule.tokensSaved * matches.length;

      results.push({
        ...rule,
        matches,
        totalTokensSaved: totalTokens,
        matchCount: matches.length,
      });
    }
  }

  results.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2) || b.totalTokensSaved - a.totalTokensSaved;
  });

  return results;
}

function applyFix(text, rule) {
  if (!rule.pattern || rule.replacement == null) return text;
  return text.replace(rule.pattern, rule.replacement).replace(/\s{2,}/g, " ").trim();
}

function applyAllFixes(text, results) {
  let fixed = text;
  for (const r of results) {
    if (r.pattern && r.replacement != null) {
      fixed = fixed.replace(r.pattern, r.replacement);
    }
  }
  return fixed.replace(/\s{2,}/g, " ").trim();
}

Object.assign(window, { ADVISOR_RULES, runAdvisor, applyFix, applyAllFixes });
