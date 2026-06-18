// Feature 3 follow-up: a single-spike pick in one window must update BOTH the
// highlight and the "picked spike #N" readout in the other window.
//   node uxtest/picksync.mjs <url>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
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

// The scatter pane's label suffix, e.g. "picked spike #1234" or "8 units".
const scatterLabel = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/amplitude scatter · ([^\n]+)/);
  return m ? m[1].trim() : null;
});

const A = await openWindow();
const B = await openWindow();
const box = await scatterBox(A);
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;

// Click around the vertical center until a point registers a pick (points are
// small; deck's pickingRadius gives some tolerance).
let aLabel = null;
for (const dy of [0, -25, 25, -50, 50, -75, 75, -100, 100]) {
  await A.mouse.click(cx, cy + dy);
  await A.waitForTimeout(400);
  aLabel = await scatterLabel(A);
  if (aLabel && /picked spike #/.test(aLabel)) break;
}
await B.waitForTimeout(600);
const bLabel = await scatterLabel(B);

const result = {
  aLabel,
  bLabel,
  picked: !!(aLabel && /picked spike #/.test(aLabel)),
  // Both windows show the SAME picked-spike readout.
  labelsMatch: aLabel != null && aLabel === bLabel,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
