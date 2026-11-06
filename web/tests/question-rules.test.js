// 杜氏への質問の決まり：選択肢を含まない・疑問符は1つだけ・答えを想定しない
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { questionProblems } from "../shared/question-rules.mjs";

const ok = q => assert.deepEqual(questionProblems(q), [], `合格のはず：${q}`);
const ng = (q, why) => {
  const p = questionProblems(q);
  assert.ok(p.length > 0, `不合格のはず：${q}`);
  if (why) assert.ok(p.some(x => x.includes(why)), `「${why}」で不合格のはず：${q} → ${p.join("／")}`);
};

test("開いた質問は合格", () => {
  ok("6号タンク、2月9日から日本酒度の動きが鈍くなっています。このときどう判断しましたか？");
  ok("5号タンク、2月10日（留添19日目）に追水40Lを入れています。どんなところを見て決めましたか？");
  ok("7号タンク、2月10日に品温を11.4℃に下げています。このときどう判断しましたか？");
});

test("選択肢を含む質問は不合格", () => {
  ng("6号タンク、日本酒度が動いていません。何もせずに様子を見ていたのでしょうか、それとも何か手を入れていたのですか？", "それとも");
  ng("7号タンク、品温を下げています。香りを見たからですか、あるいは泡の様子ですか？", "あるいは");
  ng("5号タンク、追水しています。泡が重かったのですか、櫂が重かったのですか？", "2つ");
});

test("疑問符は1つだけ", () => {
  ng("6号タンク、日本酒度が動いていません。どう判断しましたか？何か手を入れましたか？", "疑問符");
  ng("6号タンク、日本酒度が動いていません。どう判断しましたか", "疑問符");
  ng("どう判断しましたか？ 6号タンクの件です。", "文末");
});

test("答えを想定する質問は不合格", () => {
  ng("7号タンク、2月10日に品温を下げています。香り立ちが早いのを見て決めましたか？", "想定");
  ng("3号タンク、追水を入れています。泡が重かったからですか？", "想定");
  ng("6号タンク、日本酒度が止まっています。様子を見ていたのですか？", "想定");
});

test("デモデータの判断メモの質問も決まりに合う", () => {
  const { memos } = JSON.parse(readFileSync(new URL("../public/data/memos-past.json", import.meta.url)));
  for (const m of memos) ok(m.question);
});
