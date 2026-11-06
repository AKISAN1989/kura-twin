// タンクの経過グラフ（品温と日本酒度／ボーメ）を SVG で描く。日順が横軸。
const W = 340, H = 170, PAD = { l: 30, r: 34, t: 12, b: 22 };

function scale(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  return v => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

function path(points) {
  return points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
}

/** records：日順1以降の記録（その日まで）。memoDays：判断メモのある日順 */
export function tankChart(records, { memoDays = [], eventDays = [] } = {}) {
  const recs = records.filter(r => r.moromi_day != null && r.moromi_day >= 1);
  if (recs.length === 0) return `<p class="muted">まだ留添前です（グラフは留添の日から）。</p>`;
  const maxDay = Math.max(25, ...recs.map(r => r.moromi_day));
  const x = scale([1, maxDay], [PAD.l, W - PAD.r]);
  const yT = scale([5, 16], [H - PAD.b, PAD.t]);
  // 右軸：日本酒度（ボーメは ×(−10) で同じ軸に載せる。日本酒度 ≒ −10 × ボーメ）
  const yN = scale([-40, 10], [H - PAD.b, PAD.t]);

  const temp = recs.filter(r => r.temp != null).map(r => [x(r.moromi_day), yT(r.temp)]);
  const nd = recs.filter(r => r.nihonshudo != null).map(r => [x(r.moromi_day), yN(r.nihonshudo)]);
  const bm = recs.filter(r => r.baume != null && r.nihonshudo == null).map(r => [x(r.moromi_day), yN(-10 * r.baume)]);

  const grid = [5, 10, 15].map(t => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yT(t)}" y2="${yT(t)}" class="grid"/>
    <text x="${PAD.l - 4}" y="${yT(t) + 3}" class="axis" text-anchor="end">${t}℃</text>`).join("");
  const nGrid = [-30, -15, 0].map(v => `<text x="${W - PAD.r + 4}" y="${yN(v) + 3}" class="axis nd">${v}</text>`).join("");
  const days = [1, 5, 10, 15, 20, 25, 30].filter(d => d <= maxDay)
    .map(d => `<text x="${x(d)}" y="${H - 6}" class="axis" text-anchor="middle">${d}</text>`).join("");
  const marks = memoDays.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="${PAD.t}" y2="${H - PAD.b}" class="memo-line"/>`).join("")
    + eventDays.map(d => `<circle cx="${x(d)}" cy="${PAD.t + 2}" r="3" class="event-dot"/>`).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="経過グラフ">
    ${grid}${nGrid}${days}${marks}
    <path d="${path(bm)}" class="line baume"/>
    <path d="${path(nd)}" class="line nd"/>
    <path d="${path(temp)}" class="line temp"/>
  </svg>
  <div class="legend"><span class="k temp"></span>品温 <span class="k nd"></span>日本酒度 <span class="k baume"></span>ボーメ×(−10) <span class="k memo"></span>判断メモ <span class="k event"></span>変化</div>`;
}
