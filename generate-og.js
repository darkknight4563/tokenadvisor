// Generate og.png (1200x630) for Open Graph / social sharing.
// Run: node generate-og.js
// Requires: npm install @resvg/resvg-js

const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const path = require("path");

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0A0E1A"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <g opacity="0.04" stroke="#4ECDC4" stroke-width="1">
    <line x1="0" y1="100" x2="1200" y2="100"/>
    <line x1="0" y1="200" x2="1200" y2="200"/>
    <line x1="0" y1="300" x2="1200" y2="300"/>
    <line x1="0" y1="400" x2="1200" y2="400"/>
    <line x1="0" y1="500" x2="1200" y2="500"/>
    <line x1="200" y1="0" x2="200" y2="630"/>
    <line x1="400" y1="0" x2="400" y2="630"/>
    <line x1="600" y1="0" x2="600" y2="630"/>
    <line x1="800" y1="0" x2="800" y2="630"/>
    <line x1="1000" y1="0" x2="1000" y2="630"/>
  </g>

  <!-- Brand mark -->
  <rect x="80" y="60" width="44" height="44" rx="10" fill="#4ECDC4"/>
  <text x="102" y="90" font-family="monospace" font-size="24" font-weight="700" text-anchor="middle" fill="#0A0E1A">T</text>
  <text x="140" y="90" font-family="sans-serif" font-size="22" font-weight="600" fill="#E8EAED">TokenAdvisor</text>

  <!-- Headline -->
  <text x="80" y="230" font-family="sans-serif" font-size="56" font-weight="700" fill="#E8EAED">Where do your</text>
  <text x="80" y="300" font-family="sans-serif" font-size="56" font-weight="700" fill="#4ECDC4">tokens</text>
  <text x="295" y="300" font-family="sans-serif" font-size="56" font-weight="700" fill="#E8EAED"> go?</text>

  <!-- Subtitle -->
  <text x="80" y="360" font-family="sans-serif" font-size="24" fill="#9098a8">Free token analyzer with savings advice</text>

  <!-- Stylized prompt snippet with strikethrough -->
  <rect x="80" y="400" width="1040" height="120" rx="10" fill="#141a2a" stroke="#1f2940" stroke-width="1"/>

  <text x="100" y="438" font-family="monospace" font-size="16" fill="#8b93a8" text-decoration="line-through">I would like you to please</text>
  <text x="445" y="438" font-family="monospace" font-size="16" fill="#E8EAED"> ensure that you carefully</text>

  <text x="100" y="468" font-family="monospace" font-size="16" fill="#8b93a8" text-decoration="line-through">analyze and thoroughly review</text>
  <text x="490" y="468" font-family="monospace" font-size="16" fill="#4ECDC4">analyze</text>
  <text x="580" y="468" font-family="monospace" font-size="16" fill="#E8EAED"> the following data...</text>

  <text x="100" y="498" font-family="monospace" font-size="14" fill="#50FA7B">→ 12 tokens saved · $47/mo at scale</text>

  <!-- Domain tag -->
  <rect x="1000" y="560" width="160" height="36" rx="18" fill="#1f2940"/>
  <text x="1080" y="584" font-family="monospace" font-size="14" text-anchor="middle" fill="#4ECDC4">tokenadvisor.dev</text>
</svg>
`;

const resvg = new Resvg(SVG, {
  fitTo: { mode: "width", value: 1200 },
});
const pngData = resvg.render();
const pngBuffer = pngData.asPng();

fs.writeFileSync(path.join(__dirname, "og.png"), pngBuffer);
console.log("✓ og.png generated (1200x630)");
