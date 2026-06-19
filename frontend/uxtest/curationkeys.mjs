// C2 + C3 check: curation + quality-label hotkeys on the F4 dispatcher.
//
// All over the units pane (hovered = active context), reading the curation
// overlays the table already renders:
//   - merge/unmerge via `e`/`u`   (⧉ merge-group badges)
//   - delete/restore via `d`/`r`  (strikethrough on the unit name)
//   - labels via g/m/c            (the per-unit label badge)
//   - context-scoping             (`d` over the SCATTER pane does nothing)
//   - cross-window broadcast      (delete in A shows removed in B)
//
//   node uxtest/curationkeys.mjs <url> <winA.png> <winB.png>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8000/";
const outA = process.argv[3] || "/tmp/sigui_curA.png";
const outB = process.argv[4] || "/tmp/sigui_curB.png";

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
  await page.mouse.move(3, 3);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(120);
  return true;
}

// Click the nth rendered unit row (additive = ctrl-click to extend selection);
// return its unit id. Dispatches a real MouseEvent with ctrlKey so the row's
// onRowClick takes the same branch as a user ctrl-click.
const selectRow = (page, n, additive) => page.evaluate(({ n, additive }) => {
  const cbs = [...document.querySelectorAll('[data-pane="units"] input[title="visible in plots"]')];
  const cb = cbs[n];
  if (!cb) return null;
  const row = cb.closest("div").parentElement;
  const id = row.children[1]?.textContent?.trim() || null;
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: additive }));
  return id;
}, { n, additive });

// # of ⧉ merge-group badges currently rendered (one per merged unit).
const mergeBadges = (page) => page.evaluate(() =>
  document.querySelectorAll('[data-pane="units"] [title^="merge group"]').length);

// # of units rendered with a strikethrough name (i.e. marked removed).
const removedCount = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-pane="units"] span')]
    .filter((s) => /line-through/.test(s.style.textDecoration || "")).length);

// The label badge text for the row whose unit id === `id` ("" if unlabeled).
const rowLabel = (page, id) => page.evaluate((id) => {
  const cbs = [...document.querySelectorAll('[data-pane="units"] input[title="visible in plots"]')];
  for (const cb of cbs) {
    const row = cb.closest("div").parentElement;
    if (row.children[1]?.textContent?.trim() === id) return row.children[2]?.textContent?.trim() ?? "";
  }
  return null;
}, id);

const A = await openWindow("A");
const B = await openWindow("B");

// --- merge / unmerge (e / u) ---
await hoverPane(A, "units");
const id0 = await selectRow(A, 0, false);
const id1 = await selectRow(A, 1, true);
await A.keyboard.press("e");
await A.waitForTimeout(700);
const mergeAfterE = await mergeBadges(A);
await A.keyboard.press("u");
await A.waitForTimeout(700);
const mergeAfterU = await mergeBadges(A);

// --- labels (g / m / c) on a single unit ---
await selectRow(A, 0, false);
await hoverPane(A, "units");
await A.keyboard.press("g");
await A.waitForTimeout(500);
const labelG = await rowLabel(A, id0);
await A.keyboard.press("m");
await A.waitForTimeout(500);
const labelM = await rowLabel(A, id0);
await A.keyboard.press("c");
await A.waitForTimeout(500);
const labelC = await rowLabel(A, id0);

// --- context-scoping: `d` over the SCATTER pane must NOT delete ---
await selectRow(A, 0, false);
await hoverPane(A, "scatter");
await A.keyboard.press("d");
await A.waitForTimeout(500);
const removedScoped = await removedCount(A);

// --- delete / restore (d / r) over the units pane + cross-window broadcast ---
await hoverPane(A, "units");
await A.keyboard.press("d");
await A.waitForTimeout(700);
const removedA = await removedCount(A);
const removedB = await removedCount(B);
await A.keyboard.press("r");
await A.waitForTimeout(700);
const restoredA = await removedCount(A);

// --- bare `x` with nothing split is a harmless no-op ---
await A.keyboard.press("x");
await A.waitForTimeout(300);

await A.screenshot({ path: outA });
await B.screenshot({ path: outB });

const result = {
  ids: { id0, id1 },
  // e merged the two selected units (2 badges), u dissolved the group (0).
  mergeUnmerge: { afterE: mergeAfterE, afterU: mergeAfterU },
  mergeOk: mergeAfterE === 2 && mergeAfterU === 0,
  // g -> good, m -> MUA, c -> cleared.
  labels: { g: labelG, m: labelM, c: labelC },
  labelsOk: labelG === "good" && labelM === "MUA" && labelC === "",
  // `d` over the scatter pane did nothing; over units it removed 1, broadcast to
  // B; `r` restored it.
  scoping: { removedOverScatter: removedScoped, removedOverUnitsA: removedA, removedOverUnitsB: removedB, afterRestore: restoredA },
  scopingOk: removedScoped === 0 && removedA === 1 && removedB === 1 && restoredA === 0,
  errorsA: logs.A.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
  errorsB: logs.B.filter((l) => /pageerror|\[error\]/i.test(l)).slice(-4),
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
