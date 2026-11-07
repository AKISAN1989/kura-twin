// フローA：経過簿の取り込み（写真・Excel・PDF）。読み取りは src/read-pipeline.js（写真と PDF は Claude が読み、自信のない欄は拡大して読み直す）。
// 蔵ごとに書式が違うので、見出しがどの項目にあたるかは Claude が推定する。
// 初めての書式で自信のない見出しだけ「この列は品温ですか？」と蔵人に聞き、答えた対応をその蔵の書式として覚える（2回目からは聞かない）。
// それでも決まらない欄と不自然な数値だけを「要確認」にして、人が確認・修正してから保存する。
import { app } from "../app.js";
import { store } from "../store.js";
import { esc, errorBox } from "../api.js";
import { insaneFields } from "../detect.js";
import { readFile, kindOf } from "../read-pipeline.js";
import { buildGroups, checkTankByDays, fillDatesFromDays, matchFormat, normalizeLabel, FIELD_LABEL, FIELD_KEYS, RECORD_FIELDS, FIELDS } from "../../shared/sheet-map.mjs";

const $ = id => document.getElementById(id);
const KIND = Object.fromEntries(FIELDS.map(([k, , t]) => [k, t]));
const SOURCE = { photo: "写真", excel: "Excel", pdf: "PDF" };
// 確認の画面で選ぶ項目（よく使う順）
const CHOICES = ["temp", "baume", "nihonshudo", "alcohol", "acidity", "joubou", "moromi_day", "date", "time", "operation", "note", "tank", "ignore"];

let current = null; // { file, table, fields, asks: [label番号], step, format, groups }

// ---------- 読む ----------
async function read(file) {
  app.backToToday(); // 取り込みは今季の記録。過去の仕込みや判断メモを見ていたら、3Dと画面を今季の今日へ戻す
  const out = $("import-out");
  const kind = kindOf(file);
  const say = t => { out.innerHTML = `<p class="muted reading">${esc(t)}</p>`; };
  say(kind === "excel" ? "Excel を読み込んでいます…" : kind === "pdf" ? "PDF を開いています…" : "Claude が経過簿を読み取っています…（30秒ほどかかります）");
  let table;
  try {
    table = await readFile(file, { year: Number(store.currentSeason), onStep: say });
  } catch (e) {
    return errorBox(out, e.message, () => read(file));
  }
  if (!table.entries.length) {
    out.innerHTML = `<div class="error">記録を読み取れませんでした。${table.blurry ? "写真がぼやけています。撮り直してください。" : ""}</div>`;
    return;
  }
  // 覚えた書式なら、その対応で読む（聞かない）。初めてなら Claude の推定を使い、自信のない列だけ聞く
  const match = matchFormat(table.labels, store.formats);
  if (match?.all) {
    current = { file, table, fields: match.fields, asks: [], step: 0, format: match.format, known: true };
    store.saveFormat({ ...match.format, used: (match.format.used ?? 0) + 1 });
    return finish();
  }
  // 覚えた書式に近ければ、覚えている見出しはその対応で、新しい見出しだけ Claude の推定を使う
  const fields = table.labels.map((l, i) => match?.fields[i] ?? l.field);
  const asks = table.labels.map((l, i) => (match?.fields[i] == null && l.confidence === "low" ? i : -1)).filter(i => i >= 0);
  current = { file, table, fields, asks, step: 0, format: match?.format ?? null, known: false };
  if (asks.length) renderAsk(); else finish();
}

// ---------- 初めての書式：自信のない列だけ聞く（短い言葉と大きなボタン） ----------
function samples(i) {
  return current.table.entries.map(e => e.values[i]).filter(v => v != null && String(v).trim() !== "").slice(0, 4);
}

function renderAsk(choosing = false) {
  const out = $("import-out");
  const i = current.asks[current.step];
  const label = current.table.labels[i];
  const guess = current.fields[i];
  const n = current.asks.length;
  const vals = samples(i);
  out.innerHTML = `
    <section class="ask-col" aria-live="polite">
      <p class="ask-col-lead">はじめての書式です。<br>わからない列を教えてください。</p>
      <p class="ask-col-count">${current.step + 1} ／ ${n}</p>
      <div class="ask-col-label"><span class="muted small">見出し</span><strong>${esc(label.text)}</strong>
        ${vals.length ? `<span class="ask-col-vals">${vals.map(v => `<i>${esc(v)}</i>`).join("")}</span>` : ""}</div>
      ${choosing
        ? `<p class="ask-col-q">どれですか？</p>
           <div class="ask-col-choices">${CHOICES.map(k => `<button type="button" data-pick="${k}" class="${k === guess ? "guess" : ""}">${esc(FIELD_LABEL[k])}</button>`).join("")}</div>
           <button type="button" class="ask-col-back" data-back>もどる</button>`
        : `<p class="ask-col-q">この列は<br><strong>${esc(guess === "ignore" ? "使わない列" : FIELD_LABEL[guess])}</strong> ですか？</p>
           <div class="ask-col-yesno">
             <button type="button" class="yes" data-yes>はい</button>
             <button type="button" class="no" data-no>ちがう</button>
           </div>`}
    </section>`;
  out.querySelector("[data-yes]")?.addEventListener("click", () => next());
  out.querySelector("[data-no]")?.addEventListener("click", () => renderAsk(true));
  out.querySelector("[data-back]")?.addEventListener("click", () => renderAsk(false));
  out.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => { current.fields[i] = b.dataset.pick; next(); }));
  out.querySelector(".ask-col")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function next() {
  current.step++;
  if (current.step < current.asks.length) renderAsk();
  else finish();
}

// この蔵の書式として覚える（初めての書式を読み終えたとき）
function remember() {
  const labels = current.table.labels.map((l, i) => ({ norm: normalizeLabel(l.text), text: l.text, field: current.fields[i] }));
  if (current.format) {
    // 覚えた書式に近い表：新しい見出しを、その書式に足して覚える
    const have = new Set(current.format.labels.map(l => l.norm));
    const format = { ...current.format, labels: [...current.format.labels, ...labels.filter(l => l.norm && !have.has(l.norm))], used: (current.format.used ?? 0) + 1 };
    store.saveFormat(format);
    current.format = format;
    current.extended = true;
    return;
  }
  const n = store.formats.length + 1;
  const format = {
    id: `fmt-${Date.now().toString(36)}`,
    name: `書式${n}（${labels.slice(0, 4).map(l => l.text).join("・")}${labels.length > 4 ? "…" : ""}）`,
    labels, created_at: new Date().toISOString(), used: 1, source: current.table.source,
  };
  store.saveFormat(format);
  current.format = format;
}

// ---------- 確認・修正の表 ----------
function finish() {
  if (!current.known) remember();
  const year = Number(store.currentSeason);
  current.groups = buildGroups(current.table, current.fields, year).map(g => {
    // 日順が書かれていない書式は、蔵の記録の同じ日の日順を使う
    for (const r of g.records) {
      if (r.moromi_day == null && g.tank) {
        const known = app.seasonData && store.seasons[store.currentSeason].tanks.find(t => t.tank === g.tank)?.records.find(x => x.date === r.date);
        if (known?.moromi_day != null) { r.moromi_day = known.moromi_day; r._status.moromi_day = "fixed"; }
      }
      for (const k of insaneFields(r, store.rules)) r._status[k] = "check";
    }
    // 月日が読めなかった日は、日順と蔵の記録から月日を埋める（要確認のまま）
    if (g.tank) fillDatesFromDays(g, store.seasons[store.currentSeason]);
    // タンク番号を、蔵にある記録の日順と突き合わせる（合わなければ要確認にし、合うタンクを示す）
    const tc = checkTankByDays(g, store.seasons[store.currentSeason]);
    if (!tc.ok) { g.tankStatus = "check"; g.suggest = tc.suggest; }
    return g;
  });
  renderTable();
}

function cellClass(st) { return st === "check" ? "cell-check" : st === "fixed" ? "cell-fixed" : ""; }

function renderTable() {
  const out = $("import-out");
  const { table, groups } = current;
  const used = RECORD_FIELDS.filter(k => current.fields.includes(k));
  const check = groups.reduce((s, g) => s + g.records.reduce((t, r) => t + Object.values(r._status).filter(x => x === "check").length, 0), 0);
  const st = table.stats;
  const statusText = table.source === "excel"
    ? `Excel から ${groups.reduce((s, g) => s + g.records.length, 0)}日分／要確認 ${check}`
    : `読み取った欄 ${st.cells}／自信が低かった欄 ${st.low}／読み直しで確定 ${st.fixed}／要確認 ${check}`;
  const formatNote = current.known
    ? `<p class="format-note">覚えた書式「${esc(current.format.name)}」で読みました。</p>`
    : current.extended
      ? `<p class="format-note">覚えた書式「${esc(current.format.name)}」に、新しい見出しを足して覚えました。</p>`
      : `<p class="format-note">この書式を「${esc(current.format.name)}」として覚えました。次からは聞かずに読みます。</p>`;
  out.innerHTML = `
    ${table.blurry ? `<div class="error">写真がぼやけていて、読めない欄があります。読めた欄だけ表示しています。撮り直してください。</div>` : ""}
    ${formatNote}
    <p class="small">${table.source === "excel" ? "" : `${esc(SOURCE[table.source])}・`}${esc(statusText)}</p>
    <span class="legend-inline"><span class="cell-fixed">読み直しで確定</span> <span class="cell-check">要確認</span></span>
    ${groups.map((g, gi) => `
      ${g.tankStatus === "check" ? `<div class="tank-warn">タンク番号を確かめてください。${g.suggest && g.suggest !== g.tank
        ? `日順から見ると <b>${esc(app.tankLabel(g.suggest))}</b> の記録と合います。 <button type="button" class="primary" data-suggest="${gi}">${esc(app.tankLabel(g.suggest))}にする</button>` : "読み取りに自信がありません。"}</div>` : ""}
      <div class="row"><label class="${cellClass(g.tankStatus)}">タンク <select data-tank="${gi}">
        ${g.tank ? "" : `<option value="">選んでください</option>`}
        ${store.kura.tanks.map(t => `<option value="${t.id}" ${t.id === g.tank ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
        <span class="muted small">${g.records.length}日分</span></div>
      <div class="table-wrap"><table class="sheet">
        <tbody>${["date", ...used.filter(k => k !== "date")].map(k => `<tr><th>${esc(FIELD_LABEL[k])}</th>${g.records.map((r, i) =>
          `<td class="${cellClass(r._status[k])}"><input data-g="${gi}" data-i="${i}" data-k="${k}" value="${esc(r[k] ?? "")}" aria-label="${esc(FIELD_LABEL[k])} ${i + 1}列目"></td>`).join("")}</tr>`).join("")}
        </tbody></table></div>`).join("")}
    <div class="row"><button id="import-save" type="button" class="primary">確認して保存</button>
      <span class="muted small">保存すると、3Dの蔵のタンクに反映されます。</span></div>
    <div id="import-msg"></div>`;
  out.querySelectorAll("input[data-k]").forEach(inp => {
    inp.onchange = () => {
      const r = groups[Number(inp.dataset.g)].records[Number(inp.dataset.i)], k = inp.dataset.k;
      const v = inp.value.trim();
      const num = KIND[k] === "num" || KIND[k] === "int";
      r[k] = v === "" ? null : num ? Number(v) : v;
      r._status[k] = num && v !== "" && Number.isNaN(r[k]) ? "check" : "ok";
      inp.parentElement.className = cellClass(r._status[k]);
    };
  });
  out.querySelectorAll("select[data-tank]").forEach(s => {
    s.onchange = () => { const g = groups[Number(s.dataset.tank)]; g.tank = s.value || null; g.tankStatus = "ok"; renderTable(); };
  });
  out.querySelectorAll("[data-suggest]").forEach(b => {
    b.onclick = () => { const g = groups[Number(b.dataset.suggest)]; g.tank = g.suggest; g.tankStatus = "ok"; renderTable(); };
  });
  $("import-save").onclick = save;
}

function save() {
  const msg = $("import-msg");
  const { groups } = current;
  if (groups.some(g => !g.tank)) { msg.innerHTML = `<div class="error">タンクを選んでください。</div>`; return; }
  const left = groups.reduce((s, g) => s + g.records.reduce((t, r) => t + Object.values(r._status).filter(x => x === "check").length, 0), 0);
  if (left > 0 && !confirm(`要確認の欄が ${left} か所残っています。このまま保存しますか？`)) return;
  const bad = groups.flatMap(g => g.records).filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") || r.moromi_day == null || Number.isNaN(r.moromi_day));
  if (bad.length) {
    msg.innerHTML = `<div class="error">月日と日順が無い日が ${bad.length} 日あります。入れてから保存してください。</div>`;
    return;
  }
  let ok = true, days = 0, last = "";
  for (const g of groups) {
    const clean = g.records.map(r => Object.fromEntries(RECORD_FIELDS.map(k => [k, r[k] ?? null])));
    ok = store.saveImported(g.tank, clean) && ok;
    days += clean.length;
    last = [last, ...clean.map(r => r.date)].sort().pop();
  }
  const tanks = groups.map(g => g.tank);
  app.setSeason(store.currentSeason, last);
  app.selectTank(tanks[0]);
  msg.innerHTML = `<p class="ok">${esc(tanks.map(t => app.tankLabel(t)).join("・"))}に ${days} 日分を保存しました。${ok ? "" : "（この端末には保存できませんでした。再読み込みで消えます）"}</p>`;
  // 今日の経過簿：記録済み（蔵人の「今日やること」に出す）
  store.markToday(store.seasons[store.currentSeason].today, tanks.join("・"), days);
  app.emit("imported");
}

// ---------- 覚えた書式（見直し・直す・忘れる） ----------
export function renderFormats() {
  const box = $("import-formats");
  if (!box) return;
  const fs = store.formats;
  box.hidden = !fs.length;
  box.innerHTML = `<summary>覚えた書式（${fs.length}）</summary>
    <p class="muted small">見出しがどの項目にあたるかを、ここで直せます。</p>
    ${fs.map(f => `<div class="fmt" data-fmt="${esc(f.id)}">
      <div class="fmt-head"><strong>${esc(f.name)}</strong><button type="button" class="link" data-forget>忘れる</button></div>
      <table class="fmt-map">${f.labels.map(l => `<tr><th>${esc(l.text)}</th><td>→</td><td><select data-norm="${esc(l.norm)}">
        ${FIELD_KEYS.map(k => `<option value="${k}" ${k === l.field ? "selected" : ""}>${esc(FIELD_LABEL[k])}</option>`).join("")}</select></td></tr>`).join("")}</table>
    </div>`).join("")}`;
  box.querySelectorAll("[data-fmt]").forEach(el => {
    const id = el.dataset.fmt;
    el.querySelectorAll("select[data-norm]").forEach(s => { s.onchange = () => store.setFormatField(id, s.dataset.norm, s.value); });
    el.querySelector("[data-forget]").onclick = () => {
      if (!confirm("この書式を忘れます。次にこの書式を読むときは、また確認します。よろしいですか？")) return;
      store.deleteFormat(id);
      renderFormats();
    };
  });
}

/** 取り込みの途中の表を消して、最初の状態に戻す（「今日やること」に戻るとき） */
export function resetImport() {
  current = null;
  $("import-out").innerHTML = "";
  $("import-file").value = "";
  renderFormats();
}

export function initImport() {
  $("import-file").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    read(file).finally(renderFormats);
  };
  renderFormats();
}
