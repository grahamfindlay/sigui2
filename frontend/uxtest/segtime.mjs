// F3 check: shared segment navigation + time-seek. The top-bar TimeNav drives a
// shared {seg,t0,t1} window; the trace + tracemap views seek to it and write it
// back, broadcast to every window. Drive the control in window A and read the
// frame headers the views expose (globalThis.__siguiLastTrace/__siguiLastTracemap):
//   - time seek: move the scrollbar -> trace frame t0 changes
//   - segment switch (multi-seg only): pick segment 1 -> trace frame seg -> 1
//   - cross-window: window B's trace frame follows A (shared broadcast)
//   - tracemap follows: activate the tracemap tab -> its frame matches the window
//   - dropdown presence reflects num_segments (absent at 1, present at >1)
// Run against a multi-segment server to exercise everything:
//   sigui2 --synthetic --synthetic-segments 3   (then)
//   node uxtest/segtime.mjs http://127.0.0.1:8000/ /tmp/segA.png /tmp/segB.png
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_segA.png";
const outB = process.argv[4] || "/tmp/sigui_segB.png";

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

// Last trace/tracemap frame header the view drew {seg,t0,t1} (test hooks).
const lastTrace = (page) => page.evaluate(() => globalThis.__siguiLastTrace ?? null);
const lastTracemap = (page) => page.evaluate(() => globalThis.__siguiLastTracemap ?? null);

// Set an <input>/<select> (found by its title attribute) and fire the events React
// needs (mirrors mainsettings.mjs's setter).
const setByTitle = (page, title, value) => page.evaluate(({ title, value }) => {
  const el = document.querySelector(`[title="${title}"]`);
  if (!el) throw new Error("no control titled " + title);
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, { title, value });

// Fire ONLY the `input` event (a mid-drag step) or ONLY `change` (release) on a
// range input, so we can prove the scrollbar seeks on release, not per step.
const fireRange = (page, title, value, evt) => page.evaluate(({ title, value, evt }) => {
  const el = document.querySelector(`[title="${title}"]`);
  if (!el) throw new Error("no control titled " + title);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(value));
  el.dispatchEvent(new Event(evt, { bubbles: true }));
}, { title, value, evt });

const hasSegmentDropdown = (page) => page.evaluate(() => !!document.querySelector('[title="segment"]'));
const segmentOptionCount = (page) => page.evaluate(() => {
  const s = document.querySelector('[title="segment"]');
  return s ? s.options.length : 0;
});

const A = await openWindow("A");
const B = await openWindow("B");

const multiSeg = await hasSegmentDropdown(A);
const segOptions = await segmentOptionCount(A);

// Poll a window until its trace's window start reaches `target` (the seek/
// broadcast has landed + redrawn). Returns when settled or after the timeout.
const settledAt = (p, target) => p.waitForFunction(
  (tt) => { const x = globalThis.__siguiLastTrace; return x && Math.abs(x.t0 - tt) < 0.2; },
  target, { timeout: 8000 },
).catch(() => {});

// --- time seek: move the scrollbar in A; both windows should follow. The
// server's shared window persists across runs, so first force a KNOWN baseline
// (seek both to 10), then seek to a fixed different target (3). Poll BOTH
// windows to each known value so reads never race a stale frame. ---
await setByTitle(A, "seek (window start)", 10);
await settledAt(A, 10);
await settledAt(B, 10);
const before = await lastTrace(A); // ~10 in both windows now
const SEEK_T = 3;
await setByTitle(A, "seek (window start)", SEEK_T);
await settledAt(A, SEEK_T);
await settledAt(B, SEEK_T);
const afterSeekA = await lastTrace(A);
const afterSeekB = await lastTrace(B);

// --- release-only: dragging the scrollbar (input events) must NOT seek; only
// releasing it (change) does. Otherwise the trace crawls through every step. ---
await fireRange(A, "seek (window start)", 4, "input");
await fireRange(A, "seek (window start)", 6, "input");
await fireRange(A, "seek (window start)", 8, "input");
await A.waitForTimeout(500);
const duringDrag = await lastTrace(A); // should still equal afterSeek (no seek yet)
await fireRange(A, "seek (window start)", 8, "change");
await A.waitForTimeout(700);
const afterRelease = await lastTrace(A); // now jumped to ~8

// --- the "go to time" box arrow keys step the trace IMMEDIATELY (no Enter). ---
const beforeArrow = await lastTrace(A);
await A.locator('[title^="go to time"]').focus();
await A.keyboard.press("ArrowUp");
await A.waitForTimeout(700);
const afterArrow = await lastTrace(A); // stepped forward by ~one window

// --- segment switch (multi-seg only): pick segment 1 ---
let segSwitchA = null, segSwitchB = null;
if (multiSeg) {
  await setByTitle(A, "segment", 1);
  await A.waitForTimeout(900);
  segSwitchA = await lastTrace(A);
  segSwitchB = await lastTrace(B);
}

// --- tracemap follows: activate the tracemap tab in A; it adopts the shared
// window on mount and fetches, so its frame's seg/t0 match the trace's. ---
await A.getByText("tracemap", { exact: true }).first().click().catch(() => {});
await A.waitForTimeout(1200);
const tmapA = await lastTracemap(A);
const traceNowA = await lastTrace(A); // the shared window the trace last showed

await A.screenshot({ path: outA });
await B.screenshot({ path: outB });

const near = (a, b, tol = 0.2) => a != null && b != null && Math.abs(a - b) <= tol;
const expectedSeg = multiSeg ? 1 : 0;

const result = {
  multiSeg,
  segOptions,
  // Dropdown presence reflects num_segments.
  dropdownOk: multiSeg ? segOptions >= 2 : !multiSeg,
  seek: { before, target: SEEK_T, afterSeekA, afterSeekB },
  // The seek moved the trace window in A to the target...
  seekMovedA: !!before && !!afterSeekA && Math.abs(afterSeekA.t0 - before.t0) > 1
    && near(afterSeekA.t0, SEEK_T),
  // ...and window B followed to the same window (shared broadcast).
  seekSyncedB: near(afterSeekA?.t0, afterSeekB?.t0) && afterSeekA?.seg === afterSeekB?.seg,
  release: { duringDrag, afterRelease },
  // Mid-drag `input` steps didn't move the trace; the release `change` did.
  releaseOnlyOk: near(duringDrag?.t0, afterSeekA?.t0) && near(afterRelease?.t0, 8),
  arrow: { beforeArrow, afterArrow },
  // Pressing ↑ in the "go to time" box stepped the trace forward by exactly one
  // window WIDTH, immediately (no Enter).
  arrowStepsOk: !!beforeArrow && !!afterArrow
    && near(afterArrow.t0 - beforeArrow.t0, beforeArrow.t1 - beforeArrow.t0, 0.02),
  segSwitch: { segSwitchA, segSwitchB },
  // Switching the segment flipped the trace's segment to 1 in both windows.
  segSwitchOk: !multiSeg || (segSwitchA?.seg === 1 && segSwitchB?.seg === 1),
  tracemap: { tmapA, traceNowA },
  // The tracemap adopted the shared window: same segment + start as the trace.
  tracemapFollowsOk: tmapA?.seg === expectedSeg && near(tmapA?.t0, traceNowA?.t0),
  errorsA: logs.A.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
  errorsB: logs.B.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
