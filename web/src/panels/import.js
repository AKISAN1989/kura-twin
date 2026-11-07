// フローA：経過簿の取り込み。写真は Claude が読み取り（4-1）、自信のない欄は拡大して読み直す（4-4）。
// それでも決まらない欄と、不自然な数値だけを「要確認」にして、人が確認・修正してから保存する。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc, errorBox } from "../api.js";
import { insaneFields } from "../detect.js";

const $ = id => document.getElementById(id);
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

// 経過表の行（印刷用の用紙と同じ順）
const ROWS = [
  ["date", "月日", "text"], ["moromi_day", "日順", "int"], ["time", "時刻", "text"], ["operation", "操作", "text"],
  ["temp", "品温", "num"], ["baume", "ボーメ", "num"], ["nihonshudo", "日本酒度", "num"], ["alcohol", "アルコール分", "num"],
  ["acidity", "酸度", "num"], ["joubou", "状ぼう", "text"], ["note", "備考", "text"],
];
const LABEL = Object.fromEntries(ROWS.map(([k, l]) => [k, l]));
const KIND = Object.fromEntries(ROWS.map(([k, , t]) => [k, t]));

let current = null; // { tank, records: [{...values, _status: {field: "ok"|"fixed"|"check"}}], stats, image }

// ---------- 画像 ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を開けませんでした"));
    img.src = URL.createObjectURL(file);
  });
}

/** 長い辺を maxSide までに縮めた canvas */
function toCanvas(img, maxSide = 2000) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 欄の位置（割合）のまわりを少し広めに切り出して、拡大した画像にする */
function crop(canvas, r) {
  const mx = Math.max(0.03, r.w * 0.6), my = Math.max(0.03, r.h * 0.6);
  const x0 = Math.max(0, r.x - mx), y0 = Math.max(0, r.y - my);
  const x1 = Math.min(1, r.x + r.w + mx), y1 = Math.min(1, r.y + r.h + my);
  const sw = (x1 - x0) * canvas.width, sh = (y1 - y0) * canvas.height;
  const scale = Math.min(4, 800 / Math.max(sw, sh, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext("2d").drawImage(canvas, x0 * canvas.width, y0 * canvas.height, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

async function readPhoto(file) {
  const out = $("import-out");
  out.innerHTML = `<p class="muted">Claude が経過簿を読み取っています…（30秒ほどかかります）</p>`;
  const canvas = toCanvas(await loadImage(file));
  const image = canvas.toDataURL("image/jpeg", 0.9);
  const year = Number(app.isCurrent ? app.season : store.currentSeason);
  let res;
  try {
    res = await postJson("read-sheet", { image, year });
  } catch (e) {
    return errorBox(out, e.message, () => readPhoto(file));
  }

  const stats = { cells: 0, low: 0, fixed: 0, check: 0, insane: 0 };
  const records = res.records.map(r => {
    const rec = { _status: {}, _regions: r.low_regions ?? [] };
    for (const [k] of ROWS) {
      rec[k] = r[k];
      if (r[k] != null || r.confidence?.[k] === "low") stats.cells++;
      rec._status[k] = r.confidence?.[k] === "low" ? "low" : "ok";
      if (r.confidence?.[k] === "low") stats.low++;
    }
    return rec;
  });

  // 自信のない欄を、拡大して読み直す
  const jobs = [];
  records.forEach((rec, i) => {
    for (const [k] of ROWS) if (rec._status[k] === "low") jobs.push({ rec, i, k, region: rec._regions.find(g => g.field === k) });
  });
  if (jobs.length) out.innerHTML = `<p class="muted">自信のない欄が${jobs.length}か所ありました。拡大して読み直しています…</p>`;
  await pool(jobs, 3, async ({ rec, i, k, region }) => {
    if (!region) { rec._status[k] = "check"; return; }
    try {
      const neighbors = records.filter((_, j) => j !== i && Math.abs(j - i) <= 2).map(n => ({ date: n.date, value: n[k] }));
      const rr = await postJson("reread", {
        image: crop(canvas, region), field: k, fieldLabel: LABEL[k], tank: res.tank, date: rec.date, firstRead: rec[k], neighbors,
      });
      const v = KIND[k] === "text" ? rr.value_text : rr.value_number;
      if (rr.confident && v != null) { rec[k] = v; rec._status[k] = "fixed"; } else rec._status[k] = "check";
    } catch {
      rec._status[k] = "check"; // 読み直しに失敗したら人に確認してもらう
    }
  });

  for (const rec of records) {
    for (const k of insaneFields(rec, store.rules)) { rec._status[k] = "check"; stats.insane++; }
    for (const [k] of ROWS) {
      if (rec._status[k] === "fixed") stats.fixed++;
      if (rec._status[k] === "check") stats.check++;
    }
  }
  current = { tank: res.tank, records, stats, blurry: res.image_quality === "blurry", source: "photo" };
  renderTable();
}

// ---------- Excel ----------
async function readExcel(file) {
  const out = $("import-out");
  out.innerHTML = `<p class="muted">Excel を読み込んでいます…</p>`;
  let XLSX;
  try {
    XLSX = await import(/* @vite-ignore */ SHEETJS);
  } catch {
    return errorBox(out, "Excel を読む部品を取得できませんでした。通信を確認して再実行してください", () => readExcel(file));
  }
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const year = Number(app.isCurrent ? app.season : store.currentSeason);
  const byLabel = {};
  let tank = null;
  for (const row of rows) {
    const head = String(row[0] ?? "").replace(/\s/g, "");
    const hit = ROWS.find(([, l]) => head === l || head.startsWith(l));
    if (hit) byLabel[hit[0]] = row.slice(1);
    for (const cell of row) {
      const m = /(\d+)\s*号/.exec(String(cell ?? ""));
      if (m && !tank) tank = m[1];
    }
  }
  if (!byLabel.date) return errorBox(out, "「月日」の行が見つかりませんでした。経過表の書式（項目が縦、日付が横）か確認してください", () => readExcel(file));
  const n = byLabel.date.length;
  const records = [];
  for (let i = 0; i < n; i++) {
    const d = toDate(byLabel.date[i], year);
    if (!d) continue;
    const rec = { date: d, _status: {} };
    for (const [k] of ROWS) {
      if (k === "date") { rec._status.date = "ok"; continue; }
      const v = byLabel[k]?.[i] ?? null;
      rec[k] = v == null || v === "" ? null : KIND[k] === "text" ? String(v) : Number(v);
      if (rec[k] != null && KIND[k] !== "text" && Number.isNaN(rec[k])) { rec[k] = null; rec._status[k] = "check"; } else rec._status[k] = "ok";
    }
    for (const k of insaneFields(rec, store.rules)) rec._status[k] = "check";
    records.push(rec);
  }
  const check = records.reduce((s, r) => s + Object.values(r._status).filter(x => x === "check").length, 0);
  current = { tank, records, stats: { check }, source: "excel" };
  renderTable();
}

function toDate(v, year) {
  if (v instanceof Date && !Number.isNaN(v)) {
    return `${year}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = /(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/.exec(String(v ?? ""));
  return m ? `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// ---------- 確認・修正の表 ----------
function renderTable() {
  const out = $("import-out");
  const { records, stats } = current;
  if (!records.length) {
    out.innerHTML = `<div class="error">記録を読み取れませんでした。${current.blurry ? "写真がぼやけています。撮り直してください。" : ""}</div>`;
    return;
  }
  const statusText = current.source === "photo"
    ? `読み取った欄 ${stats.cells}／自信が低かった欄 ${stats.low}／読み直しで確定 ${stats.fixed}／要確認 ${stats.check}`
    : `Excel から ${records.length}日分／要確認 ${stats.check}`;
  out.innerHTML = `
    ${current.blurry ? `<div class="error">写真がぼやけていて、読めない欄があります。読めた欄だけ表示しています。撮り直してください。</div>` : ""}
    <p class="small">${esc(statusText)}</p>
    <div class="row"><label>タンク <select id="import-tank">${store.kura.tanks.map(t =>
      `<option value="${t.id}" ${t.id === current.tank ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      <span class="legend-inline"><span class="cell-fixed">読み直しで確定</span> <span class="cell-check">要確認</span></span></div>
    <div class="table-wrap"><table class="sheet">
      <tbody>${ROWS.map(([k, l]) => `<tr><th>${esc(l)}</th>${records.map((r, i) => {
        const st = r._status[k];
        return `<td class="${st === "check" ? "cell-check" : st === "fixed" ? "cell-fixed" : ""}">
          <input data-i="${i}" data-k="${k}" value="${esc(r[k] ?? "")}" aria-label="${esc(l)} ${i + 1}列目"></td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="row"><button id="import-save" type="button" class="primary">確認して保存</button>
      <span class="muted small">保存すると、3Dの蔵のタンクに反映されます。</span></div>
    <div id="import-msg"></div>`;
  out.querySelectorAll("input[data-k]").forEach(inp => {
    inp.onchange = () => {
      const r = records[Number(inp.dataset.i)], k = inp.dataset.k;
      const v = inp.value.trim();
      r[k] = v === "" ? null : KIND[k] === "text" ? v : Number(v);
      r._status[k] = KIND[k] !== "text" && v !== "" && Number.isNaN(r[k]) ? "check" : "ok";
      inp.parentElement.className = r._status[k] === "check" ? "cell-check" : "";
    };
  });
  $("import-save").onclick = save;
}

function save() {
  const msg = $("import-msg");
  const tank = $("import-tank").value;
  const left = current.records.reduce((s, r) => s + Object.values(r._status).filter(x => x === "check").length, 0);
  if (left > 0 && !confirm(`要確認の欄が ${left} か所残っています。このまま保存しますか？`)) return;
  const bad = current.records.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") || r.moromi_day == null || Number.isNaN(r.moromi_day));
  if (bad.length) {
    msg.innerHTML = `<div class="error">月日（YYYY-MM-DD）と日順が無い列が ${bad.length} 列あります。入れてから保存してください。</div>`;
    return;
  }
  const clean = current.records.map(r => Object.fromEntries(ROWS.map(([k]) => [k, r[k] ?? null])));
  const ok = store.saveImported(tank, clean);
  const last = clean.map(r => r.date).sort().pop();
  app.setSeason(store.currentSeason, last);
  app.selectTank(tank);
  msg.innerHTML = `<p class="ok">${esc(app.tankLabel(tank))}に ${clean.length} 日分を保存しました。${ok ? "" : "（この端末には保存できませんでした。再読み込みで消えます）"}</p>`;
  // 今日の経過簿：記録済み（蔵人の「今日やること」に出す）
  store.markToday(store.seasons[store.currentSeason].today, tank, clean.length);
  app.emit("imported");
}

/** 取り込みの途中の表を消して、最初の状態に戻す（「今日やること」に戻るとき） */
export function resetImport() {
  current = null;
  $("import-out").innerHTML = "";
  $("import-file").value = "";
}

export function initImport() {
  $("import-file").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) readExcel(file);
    else readPhoto(file);
  };
}
