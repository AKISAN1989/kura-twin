// 経過簿の「表」を、蔵ツインの記録（タンクごと・日ごと）に直す。写真・PDF・Excel で共通。
// 読み取り（Claude）が返すのは、書かれた見出しと値の文字のまま。どの見出しがどの項目かの対応と、値の解釈はここで行う。
// ブラウザ（取り込み画面）と、読み取りの正解率を測る検証（web/eval）の両方から使う。

/** 蔵ツインの項目：[キー, 画面の名前, 種類] */
export const FIELDS = [
  ["date", "月日", "date"],
  ["moromi_day", "日順", "int"],
  ["time", "時刻", "text"],
  ["operation", "操作", "text"],
  ["temp", "品温", "num"],
  ["baume", "ボーメ", "num"],
  ["nihonshudo", "日本酒度", "num"],
  ["alcohol", "アルコール分", "num"],
  ["acidity", "酸度", "num"],
  ["joubou", "状ぼう", "text"],
  ["note", "備考", "text"],
  ["tank", "タンク", "tank"],
];
export const RECORD_FIELDS = FIELDS.filter(([k]) => k !== "tank").map(([k]) => k);
export const FIELD_KEYS = [...FIELDS.map(([k]) => k), "ignore"];
export const FIELD_LABEL = { ...Object.fromEntries(FIELDS.map(([k, l]) => [k, l])), ignore: "使わない" };
const KIND = Object.fromEntries(FIELDS.map(([k, , t]) => [k, t]));

/** 見出しを比べるための形（空白・記号を除き、全角英数を半角に、英字は小文字に） */
export function normalizeLabel(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・:：()（）[\]【】.。,、\-_/]/g, "");
}

/** 書式の目印：見出しの集まり（順番は問わない） */
export function signature(labels) {
  return [...new Set(labels.map(l => normalizeLabel(l.text)).filter(Boolean))].sort().join("|");
}

/**
 * 覚えた書式と照らす。見出しの多く（6割以上）が覚えた書式にあれば、その書式とみなす。
 * 見つかれば { format, fields: [label ごと：覚えた項目、覚えていない見出しは null], all: すべて覚えていたか } を返す
 */
export function matchFormat(labels, formats) {
  const norms = labels.map(l => normalizeLabel(l.text));
  let best = null;
  for (const f of formats ?? []) {
    const known = new Map(f.labels.map(l => [l.norm, l.field]));
    const hits = norms.filter(n => n && known.has(n)).length;
    const cover = hits / Math.max(1, norms.filter(Boolean).length);
    if (cover >= 0.6 && (!best || cover > best.cover)) {
      best = { format: f, cover, fields: norms.map(n => (!n ? "ignore" : known.has(n) ? known.get(n) : null)) };
    }
  }
  if (!best) return null;
  return { format: best.format, fields: best.fields, all: best.fields.every(x => x != null) };
}

// 数字：全角・漢数字の記号・マイナスの書き方（−、ー、▲、△）をそろえる
function cleanNumber(text) {
  let s = String(text).normalize("NFKC").trim()
    .replace(/(°c|℃|°|%|度|ml|l)$/i, "") // NFKC で ℃ は °C になる
    .replace(/^[▲△]/, "-")
    .replace(/^[−ー―‐－]/, "-")
    .replace(/^\+/, "")
    .replace(/\s/g, "");
  if (s === "" || s === "-" || s === "ー") return { empty: true };
  const n = Number(s);
  return Number.isFinite(n) ? { value: n } : { bad: true };
}

/** 月日：「2/3」「2月3日」「02-03」「2026-02-03」→ YYYY-MM-DD */
export function toDate(text, year) {
  const s = String(text ?? "").normalize("NFKC").trim();
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /(\d{1,2})\s*[/月.\-]\s*(\d{1,2})/.exec(s);
  return m ? `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** 1つの欄の値を、項目の種類に合わせて解釈する。{ value, ok }（ok=false は「要確認」） */
export function parseCell(field, text, year) {
  if (text == null || String(text).trim() === "") return { value: null, ok: true };
  const kind = KIND[field];
  if (kind === "date") { const d = toDate(text, year); return { value: d, ok: !!d }; }
  if (kind === "tank") { const m = /(\d+)/.exec(String(text).normalize("NFKC")); return { value: m ? m[1] : null, ok: !!m }; }
  if (kind === "num" || kind === "int") {
    const r = cleanNumber(text);
    if (r.empty) return { value: null, ok: true };
    if (r.bad) return { value: null, ok: false };
    if (kind === "int" && !Number.isInteger(r.value)) return { value: Math.round(r.value), ok: false };
    return { value: r.value, ok: true };
  }
  const t = String(text).normalize("NFKC").trim();
  return { value: /^[-ー―−]+$/.test(t) ? null : String(text).trim(), ok: true };
}

/**
 * 表 → タンクごとの記録。
 * table = { tank, labels: [{ text }], entries: [{ tank, values: [...], status: ["ok"|"low"|"fixed"|"check", ...] }] }
 * fields = labels と同じ順の項目キー（"ignore" は使わない）
 * 戻り値：[{ tank, records: [{ date, ..., _status: { field: "ok"|"fixed"|"check" } }] }]
 */
export function buildGroups(table, fields, year) {
  const groups = new Map();
  for (const entry of table.entries) {
    const rec = { _status: {} };
    let tank = null;
    fields.forEach((field, i) => {
      if (!field || field === "ignore") return;
      const raw = entry.values[i];
      const { value, ok } = parseCell(field, raw, year);
      const st = entry.status?.[i] ?? "ok";
      if (field === "tank") { tank = value; return; }
      // 同じ項目に2つの列が対応したときは、先に値の入った方を使う
      if (rec[field] != null && value == null) return;
      rec[field] = value;
      rec._status[field] = !ok ? "check" : st === "low" ? "check" : st;
    });
    for (const k of RECORD_FIELDS) if (!(k in rec)) rec[k] = null;
    // 何も書かれていない列（行）は記録にしない
    if (RECORD_FIELDS.every(k => rec[k] == null)) continue;
    const t = tank ?? entry.tank ?? table.tank ?? null;
    // タンク番号の確かさ：表の中のタンクの列 → その欄の状態、用紙全体の番号 → 読み取りの状態
    const ti = fields.indexOf("tank");
    const tst = tank != null ? (entry.status?.[ti] === "low" ? "check" : entry.status?.[ti] ?? "ok")
      : entry.tank != null ? "ok" : entry.tankStatus ?? table.tankStatus ?? "ok";
    if (!groups.has(t)) groups.set(t, { records: [], tankStatus: "ok" });
    const g = groups.get(t);
    g.records.push(rec);
    if (tst === "check" || (tst === "fixed" && g.tankStatus === "ok")) g.tankStatus = tst;
  }
  return [...groups.entries()].map(([tank, g]) => ({
    tank,
    tankStatus: g.tankStatus,
    records: g.records.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? ""))),
  }));
}

/**
 * タンク番号の突き合わせ（プログラムの決まった計算。醸造の判断ではない）：
 * 読んだ日付と日順を、蔵にすでにある記録と比べる。仕込みの始まりがタンクごとにずれているので、
 * 同じ日付の日順が合うタンクは多くの場合1つに決まる。読んだタンクと合わなければ、合うタンクを返す。
 * 戻り値：{ ok: true } ／ { ok: false, suggest: "8" | null }（比べられる日が2日未満なら ok）
 */
export function checkTankByDays(group, season) {
  // 日付・日順そのものが「要確認」の日は、突き合わせに使わない
  const days = group.records.filter(r => r.date && r.moromi_day != null && r._status?.date !== "check" && r._status?.moromi_day !== "check");
  const fits = tank => {
    const recs = new Map(tank.records.map(r => [r.date, r.moromi_day]));
    const both = days.filter(r => recs.has(r.date) && recs.get(r.date) != null);
    return { n: both.length, hit: both.filter(r => recs.get(r.date) === r.moromi_day).length };
  };
  const scored = (season?.tanks ?? []).map(t => ({ id: t.tank, ...fits(t) })).filter(t => t.n >= 2);
  if (!scored.length) return { ok: true };
  const good = scored.filter(t => t.hit / t.n >= 0.8);
  if (good.some(t => t.id === group.tank)) return { ok: true };
  if (!scored.some(t => t.id === group.tank) && !good.length) return { ok: true }; // 比べられる記録が無い
  return { ok: false, suggest: good.length === 1 ? good[0].id : null };
}

const shiftDate = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * 月日が読めなかった日（空欄・要確認）を、そのタンクの日順と蔵の記録から埋める（決まった計算）。
 * 例：4号の日順15 → 4号の記録で日順14が 2/2 なら 2/3。埋めた月日は「要確認」のまま（人が確かめる）。
 */
export function fillDatesFromDays(group, season) {
  const tank = season?.tanks.find(t => t.tank === group.tank);
  const ref = tank?.records.find(r => r.moromi_day != null && r.date);
  if (!ref) return group;
  for (const r of group.records) {
    if (r.date == null && r.moromi_day != null && r._status?.moromi_day !== "check") {
      r.date = shiftDate(ref.date, r.moromi_day - ref.moromi_day);
      r._status.date = "check";
    }
  }
  group.records.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  return group;
}
