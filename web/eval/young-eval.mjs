// 蔵人の質問への回答の検証：20問（記録に答えがある15問・記録にない5問。話し言葉やあいまいな聞き方を混ぜる）。
// 取り込み画面と同じ手順（候補の抽出は src/similar.js、回答と照合は /api/young-question）で答えさせ、
// ・答えがある問い：記録から答えたか、正しい判断メモを根拠にしたか
// ・記録にない問い：「見つかりません」と答えたか
// ・作り話：答えの数字（日付・タンク・日順・数値）が、渡した記録と判断メモにすべてあるか（自動）。文の中身は人が確かめる（young-review.md）
// 使い方：netlify dev を起動して、node eval/young-eval.mjs [出力.json]
import { readFileSync, writeFileSync } from "node:fs";
import { candidatesForQuestion } from "../src/similar.js";

const data = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const cur = data("season-current.json"), past = data("season-past.json");
const seasons = { [cur.season]: cur, [past.season]: past };
const memos = data("memos-past.json").memos;
const API = process.env.API ?? "http://localhost:8888/api/young-question";

// expect：根拠にしてほしい判断メモ（どれか1つでよい）。null は記録にない問い
const QUESTIONS = [
  { q: "追水したのはどんなとき？", expect: ["past-01", "past-05", "past-08"] },
  { q: "3号に水を打ったのはなんで？", expect: ["past-01"] },
  { q: "留添12日目に日本酒度が止まったとき、どうしてた？", expect: ["past-04", "past-09"] },
  { q: "8号で数字が動かんかった時、なんで何もせんかったん？", expect: ["past-04"] },
  { q: "大吟醸の品温を下げたのはなぜですか", expect: ["past-03"] },
  { q: "暖気入れたのってどういう時？", expect: ["past-06", "past-09"] },
  { q: "泡が早く盛り上がったとき、温度ってどうしてました？", expect: ["past-02", "past-03"] },
  { q: "10号でえらい多めに水入れとったけど、あれは？", expect: ["past-08"] },
  { q: "上槽の日程がずれたとき、どうした？", expect: ["past-10"] },
  { q: "日本酒度の切れが早すぎたら、どうするもんなん？", expect: ["past-07"] },
  { q: "5号と8号、同じように止まったのに対応が違うのはなんで？", expect: ["past-04", "past-09"] },
  { q: "2号で上槽前に水打ったのは何のため？", expect: ["past-05"] },
  { q: "湧きが遅いときはどうしてた？", expect: ["past-06"] },
  { q: "品温を1.5度下げた日のこと教えて", expect: ["past-02"] },
  { q: "7号を冷やしたのは、なんか理由あったんですか", expect: ["past-10"] },
  { q: "麹の出麹は何時間でやってた？", expect: null },
  { q: "酵母は何号を使ってたの？", expect: null },
  { q: "洗米の吸水率ってどれくらいにしてた？", expect: null },
  { q: "火入れは何度でやるん？", expect: null },
  { q: "品温を上げすぎたらどうなるか教えて", expect: null },
];

// 候補に含まれる数字（判断メモと、前後の経過簿・上槽の数値）
function evidenceNumbers(candidates) {
  const nums = new Set();
  const add = v => { if (v == null) return; for (const m of String(v).matchAll(/\d+(?:\.\d+)?/g)) nums.add(Number(m[0])); };
  for (const c of candidates) {
    for (const v of Object.values(c.memo)) add(v);
    for (const r of [...(c.records ?? []), c.pressed].filter(Boolean)) for (const v of Object.values(r)) add(v);
  }
  return nums;
}
// 答えの数字：「2月5日」「12.4℃」「留添12日目」「6号」など。差（1.5℃）は根拠の数字どうしの差でもよい
function unsupportedNumbers(text, nums) {
  const out = [];
  const list = [...nums];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (nums.has(n)) continue;
    const diff = list.some(a => list.some(b => Math.abs(Math.abs(a - b) - n) < 1e-9));
    if (!diff) out.push(m[0]);
  }
  return out;
}

// ONLY=10,20 のように番号を渡すと、その問いだけを聞く（Opus の呼び出しを減らすため）
const only = process.env.ONLY?.split(",").map(Number);
const out = [];
for (const [i, item] of QUESTIONS.entries()) {
  if (only && !only.includes(i + 1)) continue;
  const candidates = candidatesForQuestion(item.q, memos, seasons, 3);
  const t0 = Date.now();
  const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: item.q, candidates }) }).then(r => r.json());
  if (res.error) { console.log(`${i + 1}. エラー：${res.error}`); out.push({ ...item, error: res.error }); continue; }
  const cited = res.sources.map(s => memos.find(m => m.season === s.season && m.tank === s.tank && m.date === s.date)?.id).filter(Boolean);
  const text = `${res.answer}${res.detail ?? ""}`;
  const bad = res.found ? unsupportedNumbers(text, evidenceNumbers(candidates)) : [];
  const r = {
    n: i + 1, q: item.q, expect: item.expect, candidates: candidates.map(c => c.memo.id), found: res.found,
    cited, rightMemo: item.expect ? cited.some(id => item.expect.includes(id)) : null,
    answer: res.answer, detail: res.detail ?? "", removed: res.removed, unsupportedNumbers: bad, ms: Date.now() - t0,
  };
  out.push(r);
  console.log(`${r.n}. ${item.expect ? "答えあり" : "記録なし"}｜${res.found ? "答えた" : "見つかりません"}｜根拠 ${cited.join(",") || "-"}｜照合で削った文 ${res.removed?.length ?? 0}｜根拠にない数字 ${bad.join(",") || "なし"}｜${item.q}`);
}
writeFileSync(process.argv[2] ?? "eval/young-results.json", JSON.stringify(out, null, 1));
