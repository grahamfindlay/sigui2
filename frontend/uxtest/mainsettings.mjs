// F2 check: the application-global settings panel (top-bar gear) round-trips and
// syncs across windows. Window A lowers `max_visible_units` below the current
// visible count; the server trims the visible set (Controller cap) and broadcasts
// it, so BOTH windows' scatter readout drops to the cap, and window B's own gear
// shows the new value (shared session). Both panes keep rendering.
//   node uxtest/mainsettings.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_mainA.png";
const outB = process.argv[4] || "/tmp/sigui_mainB.png";
const CAP = 3; // lower the visible cap to this (below the seeded 8)

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const logs = { A: [], B: [] };
async function openWindow(tag) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => logs[tag].push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs[tag].push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("connecting"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

// The scatter pane label reads the full visibleUnits.length -- a
// virtualization-proof readout of each window's visibility (same trick as
// multiwin.mjs), so we don't need the unit-table tab to be active.
const scatterUnits = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/amplitude scatter[^\d]*(\d+)\s+units/);
  return m ? Number(m[1]) : null;
});

// Open the TOP-BAR global settings gear (title "settings"; the per-pane gear is
// titled "view settings", so the exact match picks only the global one).
const openGlobalGear = (page) => page.getByTitle("settings", { exact: true }).first().click().catch(() => {});

// Set a number/select control by its row label (fires the events React needs).
const setSetting = (page, labelText, value) => page.evaluate(({ labelText, value }) => {
  const span = [...document.querySelectorAll("span")].find((s) => s.textContent === labelText);
  const input = span?.parentElement?.querySelector("input, select");
  if (!input) throw new Error("no control for " + labelText);
  const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, { labelText, value });

const readSetting = (page, labelText) => page.evaluate((labelText) => {
  const span = [...document.querySelectorAll("span")].find((s) => s.textContent === labelText);
  const input = span?.parentElement?.querySelector("input, select");
  return input ? input.value : null;
}, labelText);

const scatterHasInk = (page) => page.evaluate(() => {
  const lbl = [...document.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && /amplitude scatter/.test(e.textContent || ""));
  let n = lbl;
  while (n && !(n.querySelector && n.querySelector("canvas"))) n = n.parentElement;
  const c = n && n.querySelector("canvas");
  return !!c && c.width > 0 && c.height > 0;
});

const A = await openWindow("A");
const B = await openWindow("B");

const before = { A: await scatterUnits(A), B: await scatterUnits(B) };

// --- Window A: open the global gear, lower Max visible units below the seeded count ---
await openGlobalGear(A);
await A.waitForTimeout(300);
await setSetting(A, "Max visible units", CAP); // server trims + broadcasts to both
await A.waitForTimeout(1500);
await A.screenshot({ path: outA });

const after = { A: await scatterUnits(A), B: await scatterUnits(B) };

// --- Window B: open its global gear, read the synced value ---
await openGlobalGear(B);
await B.waitForTimeout(500);
const bMaxVisible = await readSetting(B, "Max visible units");
await B.screenshot({ path: outB });

const result = {
  before,
  after,
  windowBMaxVisible: bMaxVisible,
  // The cap actually trimmed the visible set in BOTH windows (shared broadcast).
  trimmedBothWindows: before.A > CAP && after.A === CAP && after.B === CAP,
  // B's own panel mirrors A's change (main_settings broadcast).
  syncedMaxVisible: Number(bMaxVisible) === CAP,
  // Both scatters keep rendering after the change.
  rendersA: await scatterHasInk(A),
  rendersB: await scatterHasInk(B),
  errorsA: logs.A.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
  errorsB: logs.B.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
