// 経過簿の記録から、ある日の各タンクの状態（液面の高さ・品温・状ぼう）を計算する。
// 液面は仕込み配合（初添・仲添・留添）と、操作欄の「追水 ○L」から求める。醸造の判断はしない。

const WATER_RE = /(追水|追い水|加水)\s*([0-9.]+)\s*L/i;

export function addedWaterLiters(record) {
  const text = `${record.operation ?? ""} ${record.note ?? ""}`;
  const m = text.match(WATER_RE);
  return m ? Number(m[2]) : 0;
}

/** タンク1本の、date 時点の状態。date は "YYYY-MM-DD" */
export function tankStateOn(tank, date, capacityL) {
  const recs = tank.records.filter(r => r.date <= date);
  if (recs.length === 0) {
    return { id: tank.tank, stage: "empty", level: 0, activity: 0, temp: null, joubou: null, moromi_day: null, date: null };
  }
  const last = recs[recs.length - 1];
  const { soe_l, naka_l, tome_l } = tank.recipe;
  let volume = 0;
  let stage = "moromi";
  for (const r of recs) {
    if (r.operation === "初添") volume += soe_l;
    if (r.operation === "仲添") volume += naka_l;
    if (r.operation === "留添") volume += tome_l;
    volume += addedWaterLiters(r);
  }
  if (last.operation === "上槽") {
    stage = "pressed";
  }
  // 上槽の翌日以降は空
  if (last.operation === "上槽" && last.date < date) {
    return { id: tank.tank, stage: "empty", level: 0, activity: 0, temp: null, joubou: null, moromi_day: null, date: last.date };
  }
  if (last.moromi_day <= 0) stage = "shikomi";
  return {
    activity: fermentActivity(tank, last, stage, date),
    id: tank.tank,
    stage,
    level: Math.min(1, volume / capacityL),
    temp: last.temp,
    joubou: last.joubou,
    moromi_day: last.moromi_day,
    date: last.date,
    fresh: last.date === date, // その日の記録があるか
  };
}

// 3Dの「香りの粒」と表面の泡の量（0〜1）：状ぼうから見た発酵の盛り具合。醸造の判断ではなく、見た目の演出のためだけに使う。
// 高泡〜落泡の頃がいちばん多い。仕込み前（留添の前）・上槽の日・上槽の3日前からは出さない（空のタンクは覆いがかかり 0）
const JOUBOU_ACTIVITY = { 筋泡: 0.3, 水泡: 0.5, 岩泡: 0.75, 高泡: 1.0, 落泡: 0.95, 玉泡: 0.5, 地: 0.25 };
const DAY_MS = 86400000;
export function fermentActivity(tank, last, stage, date) {
  if (stage !== "moromi" || last.moromi_day == null || last.moromi_day < 1) return 0;
  const press = tank.records.find(r => r.operation === "上槽");
  if (press && (Date.parse(press.date) - Date.parse(date)) / DAY_MS <= 3) return 0;
  return JOUBOU_ACTIVITY[last.joubou] ?? 0.4;
}

/** 季の暦：最初の初添から today（無ければ最後の記録）まで */
export function seasonCalendar(season) {
  const dates = season.tanks.flatMap(t => t.records.map(r => r.date)).sort();
  const start = dates[0];
  const end = season.today ?? dates[dates.length - 1];
  const out = [];
  for (let d = new Date(start + "T00:00:00Z"); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10);
    out.push(s);
    if (s >= end) break;
  }
  return out;
}

export function allTanksOn(season, date, capacityL) {
  return season.tanks.map(t => tankStateOn(t, date, capacityL));
}
