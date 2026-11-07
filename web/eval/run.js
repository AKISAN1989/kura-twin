// 読み取りの正解率を測る：書式の違う経過簿（eval/sheets）を、取り込み画面と同じ処理（src/read-pipeline.js）で読み、正解（truth.json）と比べる。
// 見出しの対応は、Claude の推定をそのまま使う（人の確認なし）。自信のない対応（確認を出す列）は数だけ記録する。
// 数え方：正解のある欄（空欄でない欄）ごとに「正解／要確認／誤り」。正解が空欄なのに値を読んだ欄は「誤り」に足す。
import { readFile } from "../src/read-pipeline.js";
import { score, setSeason } from "./score.js";

const params = new URLSearchParams(location.search);
const only = params.get("only")?.split(",");
const media = (params.get("media") ?? "photo,excel,pdf").split(",");
const EXT = { photo: "jpg", excel: "xlsx", pdf: "pdf", hard: "jpg", extreme: "jpg" };
const FILE = (id, m) => (m === "hard" || m === "extreme" ? `${id}-${m}.jpg` : `${id}.${EXT[m]}`);
const log = t => { document.getElementById("log").textContent += t + "\n"; };

async function main() {
  const truth = await fetch("./sheets/truth.json").then(r => r.json());
  setSeason(await fetch("/data/season-current.json").then(r => r.json()));
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
        if (params.has("debug")) (window.evalTables ??= []).push({ id, media: m, table });
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
