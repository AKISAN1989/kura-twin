// 似た状況の過去の記録と判断メモを探す（SPEC フローC・4-6）。決まった計算だけで、Claude は使わない。
// 近さ：変化の種類が同じか、醪日数（日順）・品温・日本酒度の推移がどれだけ近いか。

const RULE_WORDS = {
  stall: ["停滞", "鈍", "止ま", "動かな", "動きが", "切れ"],
  add_water: ["追水", "追い水", "加水", "水を"],
  temp_change: ["品温", "温度", "冷や", "下げ", "上げ", "暖気"],
};

/** 蔵人の質問文から、日順と変化の種類を拾う（例：「醪12日目に日本酒度の動きが鈍った」→ day 12, stall） */
export function parseQuestion(text) {
  const m = text.match(/(\d+)\s*日目/) || text.match(/日順\s*(\d+)/);
  const day = m ? Number(m[1]) : null;
  const rules = Object.entries(RULE_WORDS)
    .filter(([, words]) => words.some(w => text.includes(w)))
    .map(([rule]) => rule);
  const tankM = text.match(/(\d+)\s*号/);
  return { day, rules, tank: tankM ? tankM[1] : null };
}

function recordOn(tank, day) {
  return tank.records.find(r => r.moromi_day === day);
}

/** 日本酒度の3日間の傾き（無ければ null） */
function ndSlope(tank, day) {
  const a = recordOn(tank, day), b = recordOn(tank, day - 3);
  if (a?.nihonshudo == null || b?.nihonshudo == null) return null;
  return (a.nihonshudo - b.nihonshudo) / 3;
}

/** 判断メモに、その時の記録・前後の経過・搾った時の数値を添える */
export function memoWithContext(memo, seasons) {
  const season = seasons[memo.season];
  const tank = season?.tanks.find(t => t.tank === memo.tank);
  if (!tank) return { memo, records: [], pressed: null };
  const records = tank.records.filter(r => r.moromi_day >= memo.moromi_day - 3 && r.moromi_day <= memo.moromi_day + 5);
  const pressed = tank.records.find(r => r.operation === "上槽") ?? null;
  return { memo, kind: tank.kind, records, pressed };
}

/**
 * 質問（または今のタンクの状態）に近い判断メモを、近い順に返す。
 * query = { day, rules: [...], temp?, ndSlope?, tank? }
 */
export function rankMemos(query, memos, seasons, limit = 3) {
  const scored = memos.map(memo => {
    const season = seasons[memo.season];
    const tank = season?.tanks.find(t => t.tank === memo.tank);
    const rec = tank && recordOn(tank, memo.moromi_day);
    let score = 0;
    if (query.rules?.length) score += query.rules.includes(memo.rule) ? 0 : 10;
    if (query.day != null) score += Math.abs(query.day - memo.moromi_day) * 0.8;
    if (query.temp != null && rec?.temp != null) score += Math.abs(query.temp - rec.temp) * 0.5;
    if (query.ndSlope != null && tank) {
      const s = ndSlope(tank, memo.moromi_day);
      if (s != null) score += Math.abs(query.ndSlope - s) * 0.5;
    }
    if (query.tank != null && memo.tank === query.tank) score -= 1;
    return { memo, score };
  });
  // 何の手がかりもない質問は、推測で候補を出さない
  if (query.day == null && !query.rules?.length && query.tank == null) return [];
  return scored
    .filter(s => s.score < 10) // 変化の種類が違うもの（+10）は候補にしない
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(s => ({ ...memoWithContext(s.memo, seasons), score: Math.round(s.score * 10) / 10 }));
}

/** 今のタンクの状態から、似た状況の過去の判断メモを1件だけ探す（タンクの要約用） */
export function similarForTank(tank, date, events, memos, seasons) {
  const recs = tank.records.filter(r => r.date <= date && r.moromi_day != null);
  const today = recs[recs.length - 1];
  if (!today || today.moromi_day < 1) return null;
  const query = {
    day: today.moromi_day,
    rules: events.filter(e => e.tank === tank.tank).map(e => e.rule),
    temp: today.temp,
    ndSlope: ndSlope(tank, today.moromi_day),
  };
  if (!query.rules.length) return null; // 変化がない日は、無理に似た判断を添えない
  return rankMemos(query, memos, seasons, 1)[0] ?? null;
}
