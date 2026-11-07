// 読み取りの正解率を測る：書式の違う経過簿（eval/sheets）を、取り込み画面と同じ処理（src/read-pipeline.js）で読み、正解（truth.json）と比べる。
// 見出しの対応は、Claude の推定をそのまま使う（人の確認なし）。自信のない対応（確認を出す列）は数だけ記録する。
// 数え方：正解のある欄（空欄でない欄）ごとに「正解／要確認／誤り」。正解が空欄なのに値を読んだ欄は「誤り」に足す。
import { readFile } from "../src/read-pipeline.js";
import { buildGroups, checkTankByDays, FIELD_LABEL } from "../shared/sheet-map.mjs";

const params = new URLSearchParams(location.search);
const only = params.get("only")?.split(",");
const media = (params.get("media") ?? "photo,excel,pdf").split(",");
const EXT = { photo: "jpg", excel: "xlsx", pdf: "pdf", hard: "jpg", extreme: "jpg" };
const FILE = (id, m) => (m === "hard" || m === "extreme" ? `${id}-${m}.jpg` : `${id}.${EXT[m]}`);
const log = t => { document.getElementById("log").textContent += t + "\n"; };

const same = (key, a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a).normalize("NFKC").replace(/\s/g, "") === String(b).normalize("NFKC").replace(/\s/g, "");
};

let season;
function score(truth, table) {
  const fields = table.labels.map(l => l.field);
  const groups = buildGroups(table, fields, 2026);
  // 取り込み画面と同じく、タンク番号を蔵の記録の日順と突き合わせる（合わなければ要確認）
  for (const g of groups) if (!checkTankByDays(g, season).ok) g.tankStatus = "check";
  const keys = truth.labels.map(([, k]) => k);
  const single = new Set(truth.rows.map(r => r.tank)).size === 1;
  const r = { cells: 0, correct: 0, check: 0, wrong: 0, extra: 0, misses: [] };
  // 見出しの対応
  const truthByText = new Map(truth.labels.map(([t, k]) => [t.normalize("NFKC"), k]));
  r.mappingWrong = table.labels.filter(l => truthByText.has(l.text.normalize("NFKC")) && truthByText.get(l.text.normalize("NFKC")) !== l.field)
    .map(l => `${l.text}→${FIELD_LABEL[l.field] ?? l.field}`);
  r.asked = table.labels.filter(l => l.confidence === "low").map(l => l.text);
  // タンク番号（1枚1タンクの用紙）
  if (single) {
    r.cells++;
    const t = truth.rows[0].tank;
    if (groups.length === 1 && groups[0].tankStatus === "check") { r.check++; r.misses.push(`タンク：要確認（読み ${groups[0].tank}）`); }
    else if (groups.length === 1 && groups[0].tank === t) r.correct++; else { r.wrong++; r.misses.push(`タンク：${groups.map(g => g.tank).join(",")}`); }
  }
  for (const row of truth.rows) {
    const group = single ? groups[0] : groups.find(g => g.tank === row.tank);
    const rec = group?.records.find(x => x.date === row.date);
    for (const key of keys) {
      if (key === "tank") continue;
      const t = row.values[key];
      const p = rec ? rec[key] : null;
      const st = rec?._status?.[key];
      if (t == null) {
        if (p != null && st !== "check") { r.extra++; r.wrong++; r.cells++; r.misses.push(`${row.tank}号 ${row.date} ${key}：空欄を「${p}」`); }
        continue;
      }
      r.cells++;
      if (st === "check") r.check++;
      else if (same(key, t, p)) r.correct++;
      else { r.wrong++; r.misses.push(`${row.tank}号 ${row.date} ${key}：正解「${t}」→「${p ?? "なし"}」`); }
    }
  }
  return r;
}

async function main() {
  const truth = await fetch("./sheets/truth.json").then(r => r.json());
  season = await fetch("/data/season-current.json").then(r => r.json());
  const results = [];
  window.evalResults = results;
  for (const [id, t] of Object.entries(truth)) {
    if (only && !only.includes(id)) continue;
    for (const m of media) {
      const name = FILE(id, m);
      const blob = await fetch(`./sheets/${name}`).then(r => r.blob());
      const file = new File([blob], name, { type: blob.type });
      const t0 = performance.now();
      try {
        const table = await readFile(file, { year: 2026 });
        const s = score(t, table);
        results.push({ id, name: t.name, media: m, ms: Math.round(performance.now() - t0), ...s, stats: table.stats });
        log(`${id} ${m}：正解 ${s.correct}/${s.cells}・要確認 ${s.check}・誤り ${s.wrong}　確認する列：${s.asked.join("・") || "なし"}　対応の誤り：${s.mappingWrong.join("・") || "なし"}`);
        s.misses.slice(0, 8).forEach(x => log(`    ${x}`));
      } catch (e) {
        results.push({ id, name: t.name, media: m, error: e.message });
        log(`${id} ${m}：エラー ${e.message}`);
      }
    }
  }
  window.evalDone = true;
  if (params.has("save")) {
    await fetch("http://127.0.0.1:8899/", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: params.get("out") ?? "eval-results.json", data: "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(results, null, 1)))) }) });
  }
  log("おわり");
}
main().catch(e => { log(`エラー：${e.message}`); console.error(e); });
