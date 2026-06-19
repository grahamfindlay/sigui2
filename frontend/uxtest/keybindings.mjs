// F4 check: the context-aware keybinding dispatcher.
//
// Verifies (1) the migrated gain keys are CONTEXT-SCOPED to the hovered amplitude
// pane -- "=" bumps the trace gain only while the pointer is over the trace pane,
// not while over the units pane; (2) Space (units pane active) makes the selected
// units the visible set; (3) Alt+ArrowDown steps the sole-visible unit to the
// next in table order. Both windows share one session, so a hotkey-driven
// visibility change in window A is broadcast to window B.
//
// NB: nav is Alt+arrows, not Ctrl+arrows -- Ctrl+arrows are macOS Mission
// Control / Spaces (OS-grabbed). This Linux/headless harness can't reproduce
// that OS interception, so it would pass on the (Mac-dead) Ctrl combo too; the
// app uses Alt deliberately for the real-Mac case.
//
//   node uxtest/keybindings.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_keysA.png";
const outB = process.argv[4] || "/tmp/sigui_keysB.png";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const logs = { A: [], B: [] };
async function openWindow(tag) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on("console", (m) => logs[tag].push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs[tag].push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("connecting"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

// Scatter pane label reads the full visibleUnits.length -- virtualization-proof.
const scatterUnits = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/amplitude scatter[^\d]*(\d+)\s+units/);
  return m ? Number(m[1]) : null;
});

// The gain readout ("1.00×") inside a named pane (panes carry data-pane=<id>).
const gainOf = (page, paneId) => page.evaluate((paneId) => {
  const pane = document.querySelector(`[data-pane="${paneId}"]`);
  const span = pane && pane.querySelector('[title^="amplitude gain"] span');
  return span ? span.textContent.trim() : null;
}, paneId);

// Move the pointer into a pane (via the top bar first so a real pointerenter
// fires) -> sets that pane as the active keybinding context.
async function hoverPane(page, paneId) {
  const box = await page.evaluate((paneId) => {
    const pane = document.querySelector(`[data-pane="${paneId}"]`);
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, paneId);
  if (!box) return false;
  await page.mouse.move(3, 3);          // top bar: outside every pane
  await page.mouse.move(box.x, box.y);  // enter the target pane
  await page.waitForTimeout(120);
  return true;
}

// Single-select the first data row in the unit table; return its unit id.
const selectFirstUnit = (page) => page.evaluate(() => {
  const cb = document.querySelector('input[title="visible in plots"]');
  if (!cb) return null;
  const row = cb.closest("div").parentElement;
  const id = row.children[1]?.textContent?.trim() || null;
  row.click();
  return id;
});

// The id of the single currently-visible (checked) unit, if exactly one is.
const soleVisibleId = (page) => page.evaluate(() => {
  const checked = [...document.querySelectorAll('input[title="visible in plots"]')].filter((c) => c.checked);
  if (checked.length !== 1) return null;
  const row = checked[0].closest("div").parentElement;
  return row.children[1]?.textContent?.trim() || null;
});

const A = await openWindow("A");
const B = await openWindow("B");

// --- (1) gain keys are context-scoped to the hovered amplitude pane ---
await hoverPane(A, "trace");
const gain0 = await gainOf(A, "trace");
await A.keyboard.press("=");           // "=" is a gain-up binding (avoids shift-"+")
await A.waitForTimeout(150);
const gainUp = await gainOf(A, "trace");
await A.keyboard.press("-");           // back down
await A.waitForTimeout(150);
const gainBack = await gainOf(A, "trace");
// Hover the UNITS pane and press "=" -> trace gain must NOT change (no global key).
await hoverPane(A, "units");
await A.keyboard.press("=");
await A.waitForTimeout(150);
const gainAfterUnits = await gainOf(A, "trace");

// --- (2) Space: make the selected unit the visible set (broadcast to B) ---
const before = { A: await scatterUnits(A), B: await scatterUnits(B) };
const picked = await selectFirstUnit(A);
await hoverPane(A, "units");
await A.keyboard.press("Space");
await A.waitForTimeout(800);
const afterSpace = { A: await scatterUnits(A), B: await scatterUnits(B) };
const visibleAfterSpace = await soleVisibleId(A);

// --- (3) Alt+ArrowDown: step the sole-visible unit to the next in table order ---
await A.keyboard.press("Alt+ArrowDown");
await A.waitForTimeout(800);
const afterNav = { A: await scatterUnits(A), B: await scatterUnits(B) };
const visibleAfterNav = await soleVisibleId(A);

await A.screenshot({ path: outA });
await B.screenshot({ path: outB });

const result = {
  gain: { start: gain0, up: gainUp, back: gainBack, afterHoverUnits: gainAfterUnits },
  // "=" bumped the trace gain while hovering trace, returned on "-", and did
  // NOTHING while hovering units -> the key is pane-scoped, not global.
  gainBumps: gain0 === "1.00×" && gainUp === "1.30×" && gainBack === "1.00×",
  gainScopedToPane: gainAfterUnits === gainBack,
  space: { picked, before, afterSpace, visibleAfterSpace },
  // Space set visible = the one selected unit, in BOTH windows (shared session).
  spaceShowsSelected: afterSpace.A === 1 && afterSpace.B === 1 && visibleAfterSpace === picked,
  nav: { afterNav, visibleAfterNav },
  // Ctrl+ArrowDown kept a single unit visible but advanced to a different one.
  navAdvancesOne: afterNav.A === 1 && visibleAfterNav !== null && visibleAfterNav !== picked,
  errorsA: logs.A.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
  errorsB: logs.B.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
