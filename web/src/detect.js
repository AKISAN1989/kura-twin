// 変化の検知（SPEC フローB）。決まったルールだけで判定し、Claude は使わない。
// ルールの数値は web/public/config/rules.json。醸造の良し悪しは判定しない（「変化があった」ことだけを見る）。

function recordsUpTo(tank, date) {
  return tank.records.filter(r => r.date <= date && r.moromi_day != null);
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * ある日（date）に起きた変化を返す。
 * 戻り値：[{ id, tank, date, moromi_day, rule, change, before, after }]
 */
export function detectOnDate(season, date, rules) {
  const events = [];
  for (const tank of season.tanks) {
    const recs = recordsUpTo(tank, date);
    const today = recs[recs.length - 1];
    if (!today || today.date !== date) continue;
    if (today.moromi_day < rules.apply_from_moromi_day) continue;
    if (today.operation === "上槽") continue;
    const prev = recs[recs.length - 2];
    const base = { tank: tank.tank, date, moromi_day: today.moromi_day };

    // 品温の操作：前日比で min_delta_c 以上の上げ下げ
    if (rules.temp_change?.enabled && prev && today.temp != null && prev.temp != null) {
      const delta = Math.round((today.temp - prev.temp) * 10) / 10;
      if (Math.abs(delta) >= rules.temp_change.min_delta_c) {
        events.push({
          ...base, rule: "temp_change",
          change: `品温を前日から${fmt(Math.abs(delta))}℃${delta < 0 ? "下げた" : "上げた"}`,
          before: { temp: prev.temp }, after: { temp: today.temp },
        });
      }
    }

    // 加水：操作欄・備考欄にキーワード
    if (rules.add_water?.enabled) {
      const text = rules.add_water.fields.map(f => today[f] ?? "").join(" ");
      const hit = rules.add_water.keywords.find(k => text.includes(k));
      if (hit) {
        const src = rules.add_water.fields.map(f => today[f]).filter(Boolean).join("／");
        events.push({ ...base, rule: "add_water", change: `加水の記入がある（${src}）`, before: {}, after: {} });
      }
    }

    // 発酵の停滞：日本酒度の変化が window_days 日間で ±max_change 以内
    if (rules.stall?.enabled && today.nihonshudo != null) {
      const w = rules.stall.window_days;
      const past = recs.find(r => r.moromi_day === today.moromi_day - w);
      if (past && past.nihonshudo != null) {
        const diff = Math.round((today.nihonshudo - past.nihonshudo) * 10) / 10;
        if (Math.abs(diff) <= rules.stall.max_change) {
          events.push({
            ...base, rule: "stall",
            change: `日本酒度が${w}日間でほぼ動いていない（${fmt(past.nihonshudo)} → ${fmt(today.nihonshudo)}）`,
            before: { nihonshudo: past.nihonshudo }, after: { nihonshudo: today.nihonshudo },
          });
        }
      }
    }
  }
  return events.map(e => ({ ...e, id: `${season.season}-${e.tank}-${e.date}-${e.rule}` }));
}

/** 読み取った数値が不自然か（品温50℃など）。範囲外の項目名の一覧を返す */
export function insaneFields(record, rules) {
  const out = [];
  for (const [key, [lo, hi]] of Object.entries(rules.sanity ?? {})) {
    const v = record[key];
    if (v != null && (typeof v !== "number" || v < lo || v > hi)) out.push(key);
  }
  return out;
}
