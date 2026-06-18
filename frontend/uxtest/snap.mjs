// Headless UX harness: drive the running sigui2 app with the system Chrome via
// playwright-core (no bundled browser download), wait for it to finish loading,
// optionally run a scripted interaction, then screenshot + dump console/errors.
// Lets UI changes be checked without a human: `node uxtest/snap.mjs <url> <out.png> [action]`.
//
// WebGL note: headless Chrome renders deck.gl via SwiftShader (software) -- visual
// correctness is faithful, fps is NOT meaningful. Good for UX/logic, not perf.
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const out = process.argv[3] || "/tmp/sigui_app.png";
const action = process.argv[4] || "none";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
// Wait past the "connecting…" splash (WebSocket + first metadata), then let deck
// paint a few frames.
await page.waitForFunction(() => !document.body.innerText.includes("connecting"), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// --- optional scripted interactions (extend as needed) ---
const box = async (sel) => (await page.locator(sel).first().boundingBox());
if (action === "lasso") {
  // Toggle lasso then drag a loop over the amplitude scatter.
  await page.getByRole("button", { name: /lasso/i }).first().click().catch(() => {});
  const canvas = await box("canvas");
  if (canvas) {
    const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height / 2;
    await page.mouse.move(cx - 80, cy - 60); await page.mouse.down();
    for (const [dx, dy] of [[80, -40], [120, 60], [-40, 90], [-120, 20]]) {
      await page.mouse.move(cx + dx, cy + dy); await page.waitForTimeout(40);
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(800);
}

const info = await page.evaluate(() => ({
  gpu: document.body.innerText.match(/GPU:\s*([^\n·]+)/)?.[1]?.trim() ?? "n/a",
  canvases: document.querySelectorAll("canvas").length,
  headline: document.body.innerText.split("\n").slice(0, 3).join(" | "),
}));
await page.screenshot({ path: out });
console.log(JSON.stringify({ ...info, recentLogs: logs.slice(-15) }, null, 2));
await browser.close();
