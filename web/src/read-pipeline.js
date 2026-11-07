// 経過簿の読み取り（写真・PDF・Excel）を、どれも同じ「表」の形にそろえる。
// 表 = { source, layout, tank, labels: [{ text, field, confidence, reason }], entries: [{ tank, values, status }], stats, blurry }
// ・写真：Claude が見出しと値を書かれたとおりに読み（4-1）、自信のない欄は拡大して読み直す（4-4）
// ・PDF：ページごとに画像にして、写真と同じように読む（手書きをスキャンした PDF も、文字の PDF も）
// ・Excel：セルの文字をそのまま使い、見出しの位置と意味だけを Claude が推定する
// 取り込み画面（panels/import.js）と、読み取りの正解率を測る検証（web/eval）の両方から使う。
import { postJson } from "./api.js";
import { FIELD_LABEL } from "../shared/sheet-map.mjs";

const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export const kindOf = file => {
  const name = (file.name ?? "").toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(name)) return "excel";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "photo";
};

// ---------- 画像 ----------
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を開けませんでした"));
    img.src = URL.createObjectURL(blob);
  });
}

/** 長い辺を maxSide までに縮めた canvas */
export function toCanvas(img, maxSide = 2000) {
  const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
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

const LOW_KINDS = { date: "text", time: "text", operation: "text", joubou: "text", note: "text", tank: "text" };

/** 画像（canvas）を読む。onStep(文) で進み具合を知らせる */
export async function readCanvas(canvas, { year, page = 1, pages = 1, onStep = () => {} } = {}) {
  const image = canvas.toDataURL("image/jpeg", 0.9);
  const res = await postJson("read-sheet", { image, year, page, pages });
  const stats = { cells: 0, low: 0, fixed: 0, check: 0 };
  const entries = res.entries.map(e => {
    const status = e.values.map((_, i) => (e.low.includes(i) ? "low" : "ok"));
    e.values.forEach((v, i) => { if (v != null || status[i] === "low") stats.cells++; if (status[i] === "low") stats.low++; });
    return { tank: e.tank, values: [...e.values], status };
  });
  // 自信のない欄を、拡大して読み直す
  const jobs = [];
  entries.forEach((e, ei) => e.status.forEach((st, li) => {
    if (st === "low") jobs.push({ ei, li, region: res.low_regions.find(r => r.entry === ei && r.label === li) });
  }));
  if (jobs.length) onStep(`自信のない欄が${jobs.length}か所ありました。拡大して読み直しています…`);
  await pool(jobs, 3, async ({ ei, li, region }) => {
    const e = entries[ei];
    if (!region) { e.status[li] = "check"; return; }
    const label = res.labels[li];
    try {
      const neighbors = entries.filter((_, j) => j !== ei && Math.abs(j - ei) <= 2).map(n => ({ date: null, value: n.values[li] }));
      const rr = await postJson("reread", {
        image: crop(canvas, region), field: label.field, fieldLabel: `${label.text}（${FIELD_LABEL[label.field] ?? label.field}）`,
        tank: e.tank ?? res.tank, date: null, firstRead: e.values[li], neighbors,
      });
      const v = LOW_KINDS[label.field] ? rr.value_text : rr.value_number;
      if (rr.confident && v != null) { e.values[li] = String(v); e.status[li] = "fixed"; } else e.status[li] = "check";
    } catch {
      e.status[li] = "check"; // 読み直しに失敗したら人に確認してもらう
    }
  });
  for (const e of entries) for (const st of e.status) { if (st === "fixed") stats.fixed++; if (st === "check") stats.check++; }
  return {
    source: "photo", layout: res.layout, tank: res.tank, blurry: res.image_quality === "blurry",
    labels: res.labels.map(l => ({ text: l.text, field: l.field, confidence: l.confidence, reason: l.reason })),
    entries, stats,
  };
}

export async function readPhoto(blob, opts) {
  return readCanvas(toCanvas(await loadImage(blob)), opts);
}

// ---------- PDF ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("PDF を読む部品を取得できませんでした。通信を確認して再実行してください"));
    document.head.appendChild(s);
  });
}

/** PDF の各ページを画像（canvas）にする */
export async function pdfToCanvases(data, maxSide = 2000) {
  if (!window.pdfjsLib) await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await lib.getDocument({ data }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
    const c = document.createElement("canvas");
    c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(c);
  }
  return out;
}

/** 複数ページの表を1つにまとめる（見出しの名前でそろえる） */
export function mergeTables(tables) {
  if (tables.length === 1) return tables[0];
  const first = tables[0];
  const labels = [...first.labels];
  const key = t => t.text.normalize("NFKC").replace(/\s/g, "");
  const entries = [];
  for (const t of tables) {
    const idx = t.labels.map(l => {
      let i = labels.findIndex(x => key(x) === key(l));
      if (i < 0) { labels.push(l); i = labels.length - 1; }
      return i;
    });
    for (const e of t.entries) {
      const values = labels.map(() => null), status = labels.map(() => "ok");
      idx.forEach((to, from) => { values[to] = e.values[from]; status[to] = e.status[from]; });
      entries.push({ tank: e.tank ?? t.tank, values, status });
    }
  }
  for (const e of entries) while (e.values.length < labels.length) { e.values.push(null); e.status.push("ok"); }
  const stats = Object.fromEntries(Object.keys(first.stats).map(k => [k, tables.reduce((s, t) => s + (t.stats[k] ?? 0), 0)]));
  return { ...first, labels, entries, stats, blurry: tables.some(t => t.blurry) };
}

export async function readPdf(blob, { year, onStep = () => {} } = {}) {
  onStep("PDF をページごとの画像にしています…");
  const canvases = await pdfToCanvases(await blob.arrayBuffer());
  const tables = [];
  for (let i = 0; i < canvases.length; i++) {
    onStep(`Claude が PDF の ${i + 1}／${canvases.length} ページ目を読み取っています…（30秒ほどかかります）`);
    tables.push(await readCanvas(canvases[i], { year, page: i + 1, pages: canvases.length, onStep }));
  }
  return { ...mergeTables(tables), source: "pdf" };
}

// ---------- Excel ----------
const cellText = v => {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v)) return `${v.getMonth() + 1}/${v.getDate()}`;
  return String(v).trim();
};

export async function excelToGrid(data) {
  let XLSX;
  try {
    XLSX = await import(/* @vite-ignore */ SHEETJS);
  } catch {
    throw new Error("Excel を読む部品を取得できませんでした。通信を確認して再実行してください");
  }
  const wb = XLSX.read(data, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  return rows.slice(0, 80).map(r => r.slice(0, 40).map(cellText));
}

export async function readExcel(blob, { onStep = () => {} } = {}) {
  const grid = await excelToGrid(await blob.arrayBuffer());
  onStep("Claude が見出しの意味を確かめています…");
  const res = await postJson("read-grid", { grid });
  const at = (r, c) => grid[r]?.[c] ?? "";
  const labels = res.labels.map(l => ({ text: l.text, field: l.field, confidence: l.confidence, reason: l.reason, pos: l.pos }));
  const entries = [];
  const span = res.layout === "dates_down" ? grid.length : Math.max(...grid.map(r => r.length));
  for (let k = res.header + 1; k < span; k++) {
    const values = labels.map(l => (res.layout === "dates_down" ? at(k, l.pos) : at(l.pos, k)) || null);
    if (values.every(v => v == null)) continue;
    entries.push({ tank: null, values, status: values.map(() => "ok") });
  }
  return { source: "excel", layout: res.layout, tank: res.tank, labels, entries, stats: { cells: entries.length * labels.length, low: 0, fixed: 0, check: 0 }, blurry: false };
}

/** ファイルの種類に合わせて読む */
export function readFile(file, opts) {
  const kind = kindOf(file);
  if (kind === "excel") return readExcel(file, opts);
  if (kind === "pdf") return readPdf(file, opts);
  return readPhoto(file, opts);
}
