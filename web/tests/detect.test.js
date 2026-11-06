// 変化検知・類似抽出・用語の写しのテスト（node --test tests/）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectOnDate, insaneFields } from "../src/detect.js";
import { parseQuestion, rankMemos } from "../src/similar.js";
import { TERMS } from "../shared/terms.mjs";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const rules = load("../public/config/rules.json");
const current = load("../public/data/season-current.json");
const past = load("../public/data/season-past.json");
const memos = load("../public/data/memos-past.json").memos;

const allEvents = season => {
  const dates = [...new Set(season.tanks.flatMap(t => t.records.map(r => r.date)))].sort();
  return dates.flatMap(d => detectOnDate(season, d, rules));
};

test("今季：意図して入れた変化だけを検知する", () => {
  const got = allEvents(current).map(e => `${e.tank}:${e.moromi_day}:${e.rule}`).sort();
  assert.deepEqual(got, [
    "3:17:stall", "3:18:add_water",
    "5:19:add_water",
    "6:15:stall", "6:16:stall",
    "7:13:temp_change",
    "9:5:temp_change",
  ].sort());
});

test("前季：判断メモのある変化はすべて検知される", () => {
  const events = allEvents(past);
  for (const m of memos) {
    assert.ok(events.some(e => e.tank === m.tank && e.moromi_day === m.moromi_day),
      `${m.tank}号 ${m.moromi_day}日目（${m.change}）が検知されない`);
  }
});

test("今日（2/10）は 5号の追水・6号の停滞・7号の品温を検知する", () => {
  const got = detectOnDate(current, current.today, rules).map(e => `${e.tank}:${e.rule}`).sort();
  assert.deepEqual(got, ["5:add_water", "6:stall", "7:temp_change"]);
});

test("留添の日（日順1）以前は検知しない", () => {
  for (const e of allEvents(current)) assert.ok(e.moromi_day >= rules.apply_from_moromi_day);
});

test("不自然な数値に印をつける", () => {
  assert.deepEqual(insaneFields({ temp: 50, nihonshudo: -6 }, rules), ["temp"]);
  assert.deepEqual(insaneFields({ temp: 11.5, alcohol: null }, rules), []);
});

test("蔵人の質問から日順と変化の種類を拾い、近い判断メモを探す", () => {
  const q = parseQuestion("醪12日目に日本酒度の動きが鈍ったとき、杜氏はどうしてた？");
  assert.equal(q.day, 12);
  assert.ok(q.rules.includes("stall"));
  const hits = rankMemos(q, memos, { 2025: past });
  assert.ok(hits.length > 0);
  assert.equal(hits[0].memo.rule, "stall");
});

test("手がかりのない質問には候補を出さない", () => {
  assert.deepEqual(rankMemos(parseQuestion("こんにちは"), memos, { 2025: past }), []);
});

test("作品内プロンプトの用語は Skill と同じ", () => {
  const skill = readFileSync(new URL("../../.claude/skills/kura-terms/SKILL.md", import.meta.url), "utf8");
  assert.equal(TERMS, skill.split("---").slice(2).join("---").replace(/^\s+/, ""));
});
