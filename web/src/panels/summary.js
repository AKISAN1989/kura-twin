// 4-6 タンクの要約（若手向け）：選んだタンクのその日の状態を2〜3行で。似た状況の過去の判断を1件添える。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc, errorBox } from "../api.js";
import { similarForTank } from "../similar.js";

const $ = id => document.getElementById(id);
const cache = new Map(); // `${season}-${tank}-${date}` → 結果
let showMemoFn = () => {};
let pendingKey = null;

async function run() {
  const out = $("summary-out");
  const id = app.selected;
  if (!id) { out.innerHTML = ""; return; }
  const tank = app.tank(id);
  const recs = tank.records.filter(r => r.date <= app.date);
  const today = recs[recs.length - 1];
  if (!today) { out.innerHTML = `<p class="muted">${esc(app.tankLabel(id))}はまだ仕込み前です。</p>`; return; }
  if (today.date !== app.date && today.operation === "上槽") {
    out.innerHTML = `<p class="muted">${esc(app.tankLabel(id))}は ${esc(today.date)} に上槽しています。</p>`; return;
  }
  const key = `${app.season}-${id}-${app.date}`;
  const similar = similarForTank(tank, app.date, app.eventsOn(), store.allMemos().filter(m => m.date < app.date || m.season !== app.season), store.seasons);
  if (cache.has(key)) return show(cache.get(key), similar);
  pendingKey = key;
  out.innerHTML = `<p class="muted">${esc(app.tankLabel(id))}の状態をまとめています…</p>`;
  try {
    const res = await postJson("summarize", {
      tankLabel: app.tankLabel(id), kind: tank.kind, records: recs.slice(-4), similar,
    });
    cache.set(key, res);
    if (pendingKey === key) show(res, similar);
  } catch (e) {
    if (pendingKey === key) errorBox(out, e.message, run);
  }
}

function show(res, similar) {
  const out = $("summary-out");
  out.innerHTML = `<div class="summary">${res.lines.map(l => `<p>${esc(l)}</p>`).join("")}
    ${res.similar && similar ? `<button type="button" class="memo-link" data-memo="${esc(similar.memo.id)}">${esc(res.similar)}</button>` : ""}</div>
    <p class="muted small">数値と備考だけから Claude がまとめたもの（評価や助言はしません）</p>`;
  out.querySelector("[data-memo]")?.addEventListener("click", () => showMemoFn(similar.memo));
}

export function initSummary({ showMemo }) {
  showMemoFn = showMemo;
  // タンクを選んだとき（日付や季を変えたときも）、選んだタンクの情報の中に要約を出す
  app.onChange(kind => { if (kind !== "memo" && kind !== "tab") run(); });
}
