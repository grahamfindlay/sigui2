// Feature 3 check: scatter selection is shared across windows. Lasso in window A
// and confirm window B shows the selection (count + redrawn highlight); then
// clear from window B and confirm window A's selection drops.
//   node uxtest/selsync.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_selA.png";
const outB = process.argv[4] || "/tmp/sigui_selB.png";

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

// The scatter pane's canvas rect (find the leaf label, walk up to the pane).
const scatterBox = (page) => page.evaluate(() => {
  const lbl = [...document.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && /amplitude scatter/.test(e.textContent || ""));
  let n = lbl;
  while (n && !(n.querySelector && n.querySelector("canvas"))) n = n.parentElement;
  const c = n && n.querySelector("canvas");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

// Selection readout from a window: "<n> spikes · <m> unit(s)" if present.
const selText = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/([\d,]+)\s+spikes\s+·\s+(\d+)\s+unit/);
  return m ? { spikes: Number(m[1].replace(/,/g, "")), units: Number(m[2]) } : null;
});

const A = await openWindow();
const B = await openWindow();

// Lasso a loop in window A over its scatter canvas.
await A.getByRole("button", { name: /lasso/i }).first().click().catch(() => {});
const box = await scatterBox(A);
if (box) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  await A.mouse.move(cx - 70, cy - 45); await A.mouse.down();
  for (const [dx, dy] of [[70, -35], [100, 55], [-35, 75], [-100, 25]]) {
    await A.mouse.move(cx + dx, cy + dy); await A.waitForTimeout(40);
  }
  await A.mouse.up();
}
await A.waitForTimeout(1200);

const afterLasso = { A: await selText(A), B: await selText(B) };
await A.screenshot({ path: outA });
await B.screenshot({ path: outB });

// Clear from the OTHER window (B); window A's selection should drop.
await B.getByText("clear", { exact: true }).first().click().catch(() => {});
await B.waitForTimeout(1000);
const afterClear = { A: await selText(A), B: await selText(B) };

const result = {
  afterLasso,
  afterClear,
  // B saw the same selection A made, and clearing in B cleared A too.
  broadcastToB: afterLasso.B != null && afterLasso.A != null &&
    afterLasso.B.spikes === afterLasso.A.spikes,
  clearFromBClearedA: afterClear.A == null && afterClear.B == null,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
