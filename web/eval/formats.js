// 読み取りの検証に使う、書式の違う経過簿（すべて架空のデモデータ web/public/data/season-current.json から作る。正解はそのデータ）
// labels：[見出しの文字, 項目キー]。layout：dates_across（日付が横）／dates_down（日付が縦）
const STD = [["月日", "date"], ["日順", "moromi_day"], ["時刻", "time"], ["操作", "operation"], ["品温", "temp"], ["ボーメ", "baume"],
  ["日本酒度", "nihonshudo"], ["アルコール分", "alcohol"], ["酸度", "acidity"], ["状ぼう", "joubou"], ["備考", "note"]];

export const FORMATS = [
  {
    id: "a-standard", name: "標準（用紙どおり・日付が横）", layout: "dates_across",
    title: "醪経過表", tanks: ["3"], from: "2026-01-27", days: 8, labels: STD,
  },
  {
    id: "b-dates-down", name: "日付が縦に並ぶ", layout: "dates_down",
    title: "もろみ日誌", tanks: ["5"], from: "2026-01-29", days: 8,
    labels: [["月日", "date"], ["日順", "moromi_day"], ["品温", "temp"], ["ボーメ", "baume"], ["日本酒度", "nihonshudo"],
      ["アルコール分", "alcohol"], ["酸度", "acidity"], ["状ぼう", "joubou"], ["操作", "operation"], ["備考", "note"]],
  },
  {
    id: "c-other-names", name: "項目名が違う（BMD・SMV・アル分 など）", layout: "dates_across",
    title: "醪管理表", tanks: ["6"], from: "2026-01-27", days: 8,
    labels: [["日付", "date"], ["醪日数", "moromi_day"], ["温度", "temp"], ["BMD", "baume"], ["SMV", "nihonshudo"],
      ["アル分", "alcohol"], ["酸", "acidity"], ["泡", "joubou"], ["メモ", "note"]],
  },
  {
    id: "d-shuffled", name: "項目の順番が違う", layout: "dates_across",
    title: "醪経過表", tanks: ["7"], from: "2026-01-30", days: 8,
    labels: [["品温", "temp"], ["月日", "date"], ["状ぼう", "joubou"], ["日本酒度", "nihonshudo"], ["日順", "moromi_day"],
      ["ボーメ", "baume"], ["備考", "note"], ["アルコール分", "alcohol"], ["酸度", "acidity"], ["操作", "operation"], ["時刻", "time"]],
  },
  {
    id: "e-missing", name: "一部の項目が無い", layout: "dates_across",
    title: "醪経過表（簡易）", tanks: ["8"], from: "2026-02-01", days: 8,
    labels: [["月日", "date"], ["日順", "moromi_day"], ["品温", "temp"], ["日本酒度", "nihonshudo"], ["状ぼう", "joubou"]],
  },
  {
    id: "f-multi-tank", name: "複数のタンクを1枚に", layout: "dates_down",
    title: "仕込み日報", tanks: ["1", "2", "4"], from: "2026-02-01", days: 4,
    labels: [["日付", "date"], ["タンク", "tank"], ["日順", "moromi_day"], ["品温", "temp"], ["Bé", "baume"],
      ["日本酒度", "nihonshudo"], ["アルコール", "alcohol"], ["状態", "joubou"], ["備考", "note"]],
  },
];

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** 書式に書く値（正解）：[{ tank, date, values: { 項目キー: 値 } }]。日付が縦の複数タンクは、日付ごとにタンクを並べる */
export function sheetRows(format, season) {
  const rows = [];
  for (let d = 0; d < format.days; d++) {
    const date = addDays(format.from, d);
    for (const tank of format.tanks) {
      const rec = season.tanks.find(t => t.tank === tank)?.records.find(r => r.date === date);
      if (!rec) continue;
      const values = {};
      for (const [, key] of format.labels) values[key] = key === "tank" ? tank : key === "date" ? date : rec[key] ?? null;
      rows.push({ tank, date, values });
    }
  }
  return rows;
}

/** 用紙に書く文字（手書き・PDF）と Excel のセル */
export function cellText(key, v) {
  if (v == null) return "";
  if (key === "date") return `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`;
  if (key === "tank") return `${v}号`;
  if (key === "nihonshudo" && v < 0) return `▲${Math.abs(v)}`; // 手書きの経過簿でよく使う書き方
  return String(v);
}
