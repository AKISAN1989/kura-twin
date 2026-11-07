// 蔵コード（記録の共有）の形と、共有の記録のまとめ方
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCode, normalizeCode, formatCode, newCode, mergeDoc, emptyDoc, DEMO_CODE, CODE_ALPHABET } from "../shared/kura-code.mjs";

test("蔵コード：12文字（紛らわしい字なし）かデモ用だけを受け付ける", () => {
  assert.equal(isValidCode("AB23-CD45-EF67"), true);
  assert.equal(isValidCode("ab23 cd45 ef67"), true); // 小文字・空白も
  assert.equal(isValidCode("ＡＢ２３ＣＤ４５ＥＦ６７"), true); // 全角も
  assert.equal(isValidCode(DEMO_CODE), true);
  assert.equal(isValidCode("demo-kura-2026"), true);
  assert.equal(isValidCode("AB23-CD45"), false); // 短い
  assert.equal(isValidCode("AB23-CD45-EF0O"), false); // 0 と O は使わない
  assert.equal(formatCode("ab23cd45ef67"), "AB23-CD45-EF67");
  assert.equal(normalizeCode("AB23-CD45-EF67"), "AB23CD45EF67");
});

test("新しい蔵コード：決まった字だけで12文字。毎回違う", () => {
  const a = newCode(), b = newCode();
  assert.match(a, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok([...normalizeCode(a)].every(c => CODE_ALPHABET.includes(c)));
  assert.notEqual(a, b);
});

test("共有の記録：足す・上書きするだけ（消さない）。「知らせた」は共有しない", () => {
  let d = emptyDoc();
  d = mergeDoc(d, { records: { "3": [{ date: "2026-02-10", temp: 10.2 }] }, memos: [{ id: "m1", answer: "a" }] });
  d = mergeDoc(d, { records: { "3": [{ date: "2026-02-11", temp: 10.4 }, { date: "2026-02-10", nihonshudo: 0.6 }] }, memos: [{ id: "m2", answer: "b" }] });
  assert.deepEqual(d.records["3"].map(r => r.date), ["2026-02-10", "2026-02-11"]);
  assert.deepEqual(d.records["3"][0], { date: "2026-02-10", temp: 10.2, nihonshudo: 0.6 });
  assert.deepEqual(d.memos.map(m => m.id), ["m1", "m2"]);
  d = mergeDoc(d, { asks: [{ id: "ask-1", question: "q", seen: true }], questions: { e1: { question: "どう判断しましたか" } } });
  assert.equal("seen" in d.asks[0], false);
  assert.equal(d.questions.e1.question, "どう判断しましたか");
});
