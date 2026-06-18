// Feature 2 check: two browser windows on one shared session. A visibility
// change in window A must propagate to window B via the server broadcast, and
// the echo guard must keep it from ping-ponging. We drive A's unit-list
// "show all / none" toggle and confirm B adopts the new visible-unit count.
//   node uxtest/multiwin.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_winA.png";
const outB = process.argv[4] || "/tmp/sigui_winB.png";

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

// The scatter pane label reads the full visibleUnits.length, so it is a
// virtualization-proof readout of each window's visibility.
const scatterUnits = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/amplitude scatter[^\d]*(\d+)\s+units/);
  return m ? Number(m[1]) : null;
});

const A = await openWindow("A");
const B = await openWindow("B");

const before = { A: await scatterUnits(A), B: await scatterUnits(B) };

// Toggle "show all / none" in window A -> all units visible. The server
// broadcasts the new visibility to window B (excluding A); B should adopt it.
await A.locator('input[title="show all / none"]').first().click().catch(() => {});
await A.waitForTimeout(1500);

const after = { A: await scatterUnits(A), B: await scatterUnits(B) };
// Read B once more to confirm it settled (no echo-loop oscillation).
await B.waitForTimeout(800);
const settledB = await scatterUnits(B);

await A.screenshot({ path: outA });
await B.screenshot({ path: outB });

const result = {
  before,
  after,
  settledB,
  broadcastAdopted:
    before.B != null && after.B != null &&
    after.B === after.A && after.B !== before.B && settledB === after.B,
  errorsA: logs.A.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
  errorsB: logs.B.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
