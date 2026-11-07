// 読み取りの検証結果（eval/results-*.json）を、README に載せる表（Markdown）にする
// 使い方：node eval/report.mjs eval/results-round1.json eval/results-round1-hard.json
import { readFileSync } from "node:fs";

const MEDIA = { photo: "手書き風の写真", pdf: "スキャンした PDF", excel: "Excel", hard: "悪条件の写真", extreme: "限界の写真" };
const ORDER = ["photo", "hard", "extreme", "pdf", "excel"];
// 後のファイルの結果で上書きする（ただしエラーで測れなかったものは、前の結果を残す）
const byKey = new Map();
for (const f of process.argv.slice(2)) for (const r of JSON.parse(readFileSync(f, "utf8"))) {
  const k = `${r.id}|${r.media}`;
  if (!r.error || !byKey.has(k)) byKey.set(k, r);
}
const rows = [...byKey.values()];
const ids = [...new Set(rows.map(r => r.id))];
const media = ORDER.filter(m => rows.some(r => r.media === m));
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "-");
const cell = r => (!r ? "-" : r.error ? "エラー" : `${pct(r.correct, r.cells)}（${r.correct}/${r.cells}${r.check ? `・要確認${r.check}` : ""}${r.wrong ? `・誤り${r.wrong}` : ""}）`);

console.log(`| 書式 | ${media.map(m => MEDIA[m]).join(" | ")} | 確認した見出し |`);
console.log(`|---|${media.map(() => "---").join("|")}|---|`);
for (const id of ids) {
  const of = m => rows.find(r => r.id === id && r.media === m);
  const asked = [...new Set(rows.filter(r => r.id === id).flatMap(r => (r.asked ?? []).map(a => `${a}（${MEDIA[r.media]}）`)))];
  const askedByLabel = {};
  for (const r of rows.filter(r => r.id === id)) for (const a of r.asked ?? []) (askedByLabel[a] ??= []).push(MEDIA[r.media]);
  const askedText = Object.entries(askedByLabel).map(([a, ms]) => (ms.length === media.length ? a : `${a}（${ms.join("・")}）`)).join("、") || "なし";
  console.log(`| ${rows.find(r => r.id === id).name} | ${media.map(m => cell(of(m))).join(" | ")} | ${askedText} |`);
  void asked;
}
const sum = m => rows.filter(r => r.media === m && !r.error).reduce((s, r) => ({ c: s.c + r.correct, n: s.n + r.cells, w: s.w + r.wrong, k: s.k + r.check }), { c: 0, n: 0, w: 0, k: 0 });
console.log(`| **合計** | ${media.map(m => { const s = sum(m); return `**${pct(s.c, s.n)}**（${s.c}/${s.n}${s.k ? `・要確認${s.k}` : ""}${s.w ? `・誤り${s.w}` : ""}）`; }).join(" | ")} | |`);
