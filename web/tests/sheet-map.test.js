// 経過簿の表 → 記録（書式の違い・数値の書き方・覚えた書式）
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLabel, parseCell, toDate, buildGroups, matchFormat, signature } from "../shared/sheet-map.mjs";

test("見出しの比べ方：全角・空白・記号の違いを無視する", () => {
  assert.equal(normalizeLabel("ＢＭＤ"), "bmd");
  assert.equal(normalizeLabel(" アル分 "), "アル分");
  assert.equal(normalizeLabel("品温（℃）"), normalizeLabel("品温℃"));
});

test("数値：▲・△・全角マイナスはマイナス、単位は外す", () => {
  assert.deepEqual(parseCell("nihonshudo", "▲3.5", 2026), { value: -3.5, ok: true });
  assert.deepEqual(parseCell("nihonshudo", "△12", 2026), { value: -12, ok: true });
  assert.deepEqual(parseCell("nihonshudo", "－4", 2026), { value: -4, ok: true });
  assert.deepEqual(parseCell("temp", "12.5℃", 2026), { value: 12.5, ok: true });
  assert.deepEqual(parseCell("temp", "１０．２", 2026), { value: 10.2, ok: true });
  assert.equal(parseCell("temp", "読めない", 2026).ok, false);
  assert.deepEqual(parseCell("temp", "", 2026), { value: null, ok: true });
});

test("月日：いろいろな書き方を YYYY-MM-DD に", () => {
  assert.equal(toDate("2/3", 2026), "2026-02-03");
  assert.equal(toDate("1月27日", 2026), "2026-01-27");
  assert.equal(toDate("2026-02-10", 2025), "2026-02-10");
  assert.equal(toDate("あいう", 2026), null);
});

test("1枚に複数のタンク：タンクの列でまとめる", () => {
  const table = {
    tank: null,
    labels: [{ text: "日付" }, { text: "タンク" }, { text: "品温" }],
    entries: [
      { values: ["2/1", "1号", "10.5"], status: ["ok", "ok", "ok"] },
      { values: ["2/1", "2号", "9.8"], status: ["ok", "ok", "low"] },
      { values: ["2/2", "1号", "10.6"], status: ["ok", "ok", "ok"] },
    ],
  };
  const groups = buildGroups(table, ["date", "tank", "temp"], 2026);
  assert.deepEqual(groups.map(g => [g.tank, g.records.length]), [["1", 2], ["2", 1]]);
  assert.equal(groups[1].records[0]._status.temp, "check"); // 自信のない欄は要確認
});

test("覚えた書式：見出しがすべて覚えた中にあれば、その対応で読む", () => {
  const format = { id: "f1", labels: [{ norm: "日付", field: "date" }, { norm: "温度", field: "temp" }, { norm: "bmd", field: "baume" }] };
  const hit = matchFormat([{ text: "日付" }, { text: "ＢＭＤ" }, { text: "温度" }], [format]);
  assert.deepEqual(hit.fields, ["date", "baume", "temp"]);
  assert.equal(matchFormat([{ text: "日付" }, { text: "室温" }], [format]), null);
  assert.equal(signature([{ text: "温度" }, { text: "日付" }]), signature([{ text: "日付" }, { text: "温度" }]));
});
