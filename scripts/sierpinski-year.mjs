#!/usr/bin/env node
// Sierpinski year.
//
// Pulls the trailing 365 days of GitHub contributions and folds them onto a
// depth-5 Sierpinski gasket: 3^5 = 243 leaf triangles, each one covering a
// contiguous 1-2 day slice of the year (365 / 243 = 1.502). Leaves are laid
// out in geometric reading order, so time runs apex -> base: oldest day at the
// top point, today along the bottom edge.
//
// Emits a light and a dark SVG. No dependencies.

const USER = process.env.GH_USER || "Aushtiin";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "dist";
const DEPTH = 5;
const DAYS = 365;

const W = 760;
const PAD = 18;
const HEAD = 30;
const GAP_TOP = 12;
const H_TRI = 468;
const GAP_BOT = 14;
const FOOT = 24;
const SVG_H = PAD + HEAD + GAP_TOP + H_TRI + GAP_BOT + FOOT + PAD;

const INSET = 0.86; // shrink each leaf toward its centroid to open up the mesh
const CYCLE = 14; // seconds per animation loop
const SWEEP = 3.6; // seconds for the fill to travel apex -> base

const THEMES = {
  light: {
    name: "light",
    empty: "#e7ecf0",
    ramp: ["#bdf0cd", "#74e096", "#22c55e", "#15904a", "#0b5c2f"],
    text: "#8b949e",
    faint: "#c5ced6",
    glow: false,
  },
  dark: {
    name: "dark",
    empty: "#171c23",
    ramp: ["#0c3a22", "#116b3b", "#1a9e52", "#2fd06d", "#4dff93"],
    text: "#7d8590",
    faint: "#2b333d",
    glow: true,
  },
};

async function fetchDays() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
  const to = new Date();
  const from = new Date(to.getTime() - (DAYS + 7) * 864e5);
  const query = `
    query($login:String!, $from:DateTime!, $to:DateTime!) {
      user(login:$login) {
        contributionsCollection(from:$from, to:$to) {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "sierpinski-year",
    },
    body: JSON.stringify({
      query,
      variables: { login: USER, from: from.toISOString(), to: to.toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error(`no contribution calendar for ${USER}`);
  const today = new Date().toISOString().slice(0, 10);
  return cal.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date <= today)
    .slice(-DAYS)
    .map((d) => ({ date: d.date, count: d.contributionCount }));
}

// --- geometry -------------------------------------------------------------

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function gasket(a, b, c, depth, out) {
  if (depth === 0) {
    out.push([a, b, c]);
    return;
  }
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  gasket(a, ab, ca, depth - 1, out);
  gasket(ab, b, bc, depth - 1, out);
  gasket(ca, bc, c, depth - 1, out);
}

function inset(tri, k) {
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  return tri.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

// --- levels ---------------------------------------------------------------

function levelsFor(values) {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!nz.length) return () => 0;
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))];
  const cuts = [q(0.3), q(0.55), q(0.75), q(0.92)];
  return (v) => {
    if (v <= 0) return 0;
    for (let i = 0; i < cuts.length; i++) if (v <= cuts[i]) return i + 1;
    return 5;
  };
}

// --- render ---------------------------------------------------------------

const fmt = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (n) => Math.round(n * 100) / 100;

function render(days, theme) {
  const t = THEMES[theme];
  const topY = PAD + HEAD + GAP_TOP;
  const apex = [W / 2, topY];
  const bl = [PAD, topY + H_TRI];
  const br = [W - PAD, topY + H_TRI];

  const leaves = [];
  gasket(apex, bl, br, DEPTH, leaves);
  // geometric reading order: apex first, base last
  leaves.sort((p, q) => {
    const py = (p[0][1] + p[1][1] + p[2][1]) / 3;
    const qy = (q[0][1] + q[1][1] + q[2][1]) / 3;
    if (Math.abs(py - qy) > 0.01) return py - qy;
    const px = (p[0][0] + p[1][0] + p[2][0]) / 3;
    const qx = (q[0][0] + q[1][0] + q[2][0]) / 3;
    return px - qx;
  });

  const N = leaves.length;
  const D = days.length;
  // each leaf owns a contiguous slice of the year; no day is dropped or doubled
  const buckets = [];
  for (let i = 0; i < N; i++) {
    const lo = Math.floor((i * D) / N);
    const hi = Math.floor(((i + 1) * D) / N);
    const slice = days.slice(lo, Math.max(hi, lo + 1));
    buckets.push(slice.reduce((s, d) => s + d.count, 0));
  }

  const level = levelsFor(buckets);
  const total = days.reduce((s, d) => s + d.count, 0);

  const cells = leaves
    .map((tri, i) => {
      const lv = level(buckets[i]);
      const pts = inset(tri, INSET)
        .map(([x, y]) => `${r2(x)},${r2(y)}`)
        .join(" ");
      const delay = r2((i / N) * SWEEP);
      return `<polygon class="c l${lv}" points="${pts}" style="animation-delay:${delay}s"/>`;
    })
    .join("");

  const legend = t.ramp
    .map((c, i) => `<rect class="k" x="${W - PAD - 76 + i * 13}" y="${SVG_H - PAD - 15}" width="9" height="9" rx="2" fill="${c}"/>`)
    .join("");

  const rampCss = t.ramp
    .map((c, i) => `.l${i + 1}{fill:${c};stroke:${c}}`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SVG_H}" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label="${esc(USER)} contributions for the last 365 days, drawn as a Sierpinski triangle">
<style>
  .c{fill:${t.empty};stroke:${t.empty};stroke-width:1.1;stroke-linejoin:round;opacity:0;animation:rise ${CYCLE}s ease-out infinite}
  ${rampCss}
  ${t.glow ? ".l5{filter:drop-shadow(0 0 2.5px #4dff93)}" : ""}
  .t{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:12px;fill:${t.text}}
  .f{fill:${t.faint}}
  @keyframes rise{0%,1%{opacity:0}9%{opacity:1}90%{opacity:1}98%,100%{opacity:0}}
  @media (prefers-reduced-motion:reduce){.c{opacity:1;animation:none}}
</style>
<text class="t" x="${PAD}" y="${PAD + 18}">$ ./sierpinski --year</text>
<text class="t" x="${W - PAD}" y="${PAD + 18}" text-anchor="end">${fmt(total)} contributions</text>
<g>${cells}</g>
<text class="t f" x="${PAD}" y="${SVG_H - PAD - 6}">${days[0].date} → ${days[days.length - 1].date}</text>
<text class="t f" x="${W / 2}" y="${SVG_H - PAD - 6}" text-anchor="middle">apex → base · oldest → today</text>
${legend}
</svg>
`;
}

// --- main -----------------------------------------------------------------

const { mkdir, writeFile } = await import("node:fs/promises");
const days = await fetchDays();
if (days.length < 30) throw new Error(`only got ${days.length} days back`);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/sierpinski-year.svg`, render(days, "light"));
await writeFile(`${OUT_DIR}/sierpinski-year-dark.svg`, render(days, "dark"));
console.log(`wrote ${OUT_DIR}/sierpinski-year{,-dark}.svg — ${days.length} days, ${days[0].date} → ${days[days.length - 1].date}`);
