// 読み取った表を正解と比べる（検証ページ run.js と、Node での数え直し rescore.mjs で共通）
import { buildGroups, checkTankByDays, fillDatesFromDays, FIELD_LABEL } from "../shared/sheet-map.mjs";

const same = (key, a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a).normalize("NFKC").replace(/\s/g, "") === String(b).normalize("NFKC").replace(/\s/g, "");
};

let season;
export const setSeason = s => { season = s; };
export function score(truth, table) {
  const fields = table.labels.map(l => l.field);
  const groups = buildGroups(table, fields, 2026);
  // 取り込み画面と同じく、タンク番号を蔵の記録の日順と突き合わせる（合わなければ要確認）
  for (const g of groups) {
    if (g.tank) fillDatesFromDays(g, season); // 取り込み画面と同じく、読めなかった月日を日順から埋める（要確認）
    if (!checkTankByDays(g, season).ok) g.tankStatus = "check";
  }
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

