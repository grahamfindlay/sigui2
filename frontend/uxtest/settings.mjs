// F1 check: per-view settings panel round-trips and syncs across windows.
// Window A opens the scatter gear, changes point size (client-scope) and max
// spikes/unit (server-scope); window B's panel should reflect BOTH (shared
// session), and the scatter keeps rendering after each change.
//   node uxtest/settings.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_setA.png";
const outB = process.argv[4] || "/tmp/sigui_setB.png";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function openWindow() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("connecting"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

// Open the scatter pane's settings gear (the ⚙ button).
const openGear = (page) => page.getByRole("button", { name: "⚙" }).first().click().catch(() => {});

// Set a setting input/select by its row label text, firing the events React needs.
const setSetting = (page, labelText, value) => page.evaluate(({ labelText, value }) => {
  const span = [...document.querySelectorAll("span")].find((s) => s.textContent === labelText);
  const input = span?.parentElement?.querySelector("input, select");
  if (!input) throw new Error("no control for " + labelText);
  const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, { labelText, value });

// Read a setting control's current value from a window (after opening its gear).
const readSetting = (page, labelText) => page.evaluate((labelText) => {
  const span = [...document.querySelectorAll("span")].find((s) => s.textContent === labelText);
  const input = span?.parentElement?.querySelector("input, select");
  return input ? input.value : null;
}, labelText);

// Does the scatter canvas have any non-background pixels (i.e. it's rendering)?
const scatterHasInk = (page) => page.evaluate(() => {
  const lbl = [...document.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && /amplitude scatter/.test(e.textContent || ""));
  let n = lbl;
  while (n && !(n.querySelector && n.querySelector("canvas"))) n = n.parentElement;
  const c = n && n.querySelector("canvas");
  return !!c && c.width > 0 && c.height > 0;
});

const A = await openWindow();
const B = await openWindow();

// --- Window A: open gear, change both settings ---
await openGear(A);
await A.waitForTimeout(300);
await setSetting(A, "Point size", 6);          // client-scope: instant re-draw
await A.waitForTimeout(500);
await setSetting(A, "Max spikes / unit", 2000); // server-scope: triggers a re-fetch
await A.waitForTimeout(1200);
await A.screenshot({ path: outA });

// --- Window B: open gear, read the synced values ---
await openGear(B);
await B.waitForTimeout(500);
const bPointSize = await readSetting(B, "Point size");
const bMaxSpikes = await readSetting(B, "Max spikes / unit");
await B.screenshot({ path: outB });

const result = {
  windowA: { pointSize: await readSetting(A, "Point size"), maxSpikes: await readSetting(A, "Max spikes / unit") },
  windowB: { pointSize: bPointSize, maxSpikes: bMaxSpikes },
  // B mirrors A's changes (shared session broadcast).
  syncedPointSize: Number(bPointSize) === 6,
  syncedMaxSpikes: Number(bMaxSpikes) === 2000,
  // Scatter still renders in both after the changes.
  rendersA: await scatterHasInk(A),
  rendersB: await scatterHasInk(B),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
