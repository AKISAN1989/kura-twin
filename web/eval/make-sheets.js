// 検証用の経過簿をつくる：書式ごとに「手書き風の写真」「スキャンした PDF」「Excel」と正解（truth.json）。
// 値は架空のデモデータ（season-current.json）。手書きは手書き風の書体に、字ごとの傾き・揺れ・濃さのむらを付けて描く。
import { FORMATS, sheetRows, cellText } from "./formats.js";

const SAVE = new URLSearchParams(location.search).has("save");
const log = t => { document.getElementById("log").textContent += t + "\n"; };
const HANDS = [['600 40px "Klee One"', "Klee One"], ['400 42px "Yomogi"', "Yomogi"], ['400 42px "Zen Kurenaido"', "Zen Kurenaido"]];
const INK = ["#1c2550", "#23264a", "#1a1a2e"];
const PRINT = '"Hiragino Mincho ProN", "Yu Mincho", serif';

// 決まった乱数（同じ用紙を何度つくっても同じになるように）
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
let MESSY = 1; // 悪条件の写真では、字の揺れ・傾きを大きくする
const jit = a => (rnd() * 2 - 1) * a * MESSY;

async function save(name, dataUrl) {
  if (!SAVE) return;
  const r = await fetch("http://127.0.0.1:8899/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, data: dataUrl }) });
  log(`保存：${await r.text()}`);
}

// 手書きの文字列（1字ずつ傾け、揺らす）
function hand(ctx, text, cx, cy, maxW, font, ink) {
  if (!text) return;
  const chars = [...text];
  let size = 40;
  ctx.font = font.replace(/\d+px/, `${size}px`);
  while (ctx.measureText(text).width > maxW - 12 && size > 18) { size -= 2; ctx.font = font.replace(/\d+px/, `${size}px`); }
  const widths = chars.map(c => ctx.measureText(c).width * 0.96);
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2 + jit(4);
  const base = cy + size * 0.35 + jit(3);
  for (let i = 0; i < chars.length; i++) {
    ctx.save();
    ctx.translate(x + widths[i] / 2, base + jit(1.5));
    ctx.rotate(jit(0.06));
    ctx.globalAlpha = 0.8 + rnd() * 0.2;
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.font = font.replace(/\d+px/, `${Math.round(size * (0.95 + rnd() * 0.1))}px`);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    x += widths[i];
  }
}

// 用紙（白い紙に印刷された罫線と見出し、手書きの値）
function drawPaper(format, rows, font, ink) {
  const across = format.layout === "dates_across";
  const labelW = 210, cellW = across ? 160 : null;
  const colW = key => (key === "note" || key === "operation" ? 230 : key === "date" || key === "tank" ? 130 : 140);
  const rowH = key => (key === "note" ? 100 : 76);
  const top = 150, left = 50;
  const W = across ? left * 2 + labelW + cellW * rows.length : left * 2 + format.labels.reduce((s, [, k]) => s + colW(k), 0);
  const H = across ? top + format.labels.reduce((s, [, k]) => s + rowH(k), 0) + 70 : top + 70 + 70 * rows.length + 70;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fdfcf7"; ctx.fillRect(0, 0, W, H);
  // 題と欄外（印刷）
  ctx.fillStyle = "#222"; ctx.font = `700 40px ${PRINT}`; ctx.textAlign = "left";
  ctx.fillText(format.title, left, 70);
  ctx.font = `400 26px ${PRINT}`;
  ctx.fillText("2026年", left + 360, 66);
  if (format.tanks.length === 1) {
    ctx.fillText("タンク No.", left + 520, 66);
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(left + 650, 74); ctx.lineTo(left + 760, 74); ctx.stroke();
    hand(ctx, format.tanks[0], left + 700, 52, 100, font, ink);
  }
  ctx.strokeStyle = "#333"; ctx.lineWidth = 2;
  ctx.textAlign = "center";
  if (across) {
    let y = top;
    for (const [label, key] of format.labels) {
      const h = rowH(key);
      ctx.strokeRect(left, y, labelW, h);
      ctx.fillStyle = "#f3efe4"; ctx.fillRect(left + 1, y + 1, labelW - 2, h - 2);
      ctx.fillStyle = "#222"; ctx.font = `500 28px ${PRINT}`; ctx.fillText(label, left + labelW / 2, y + h / 2 + 10);
      rows.forEach((r, i) => {
        const x = left + labelW + i * cellW;
        ctx.strokeRect(x, y, cellW, h);
        hand(ctx, cellText(key, r.values[key]), x + cellW / 2, y + h / 2 - 4, cellW, font, ink);
      });
      y += h;
    }
  } else {
    let x = left;
    const xs = format.labels.map(([, k]) => { const v = x; x += colW(k); return v; });
    format.labels.forEach(([label, key], i) => {
      ctx.strokeRect(xs[i], top, colW(key), 70);
      ctx.fillStyle = "#f3efe4"; ctx.fillRect(xs[i] + 1, top + 1, colW(key) - 2, 68);
      ctx.fillStyle = "#222"; ctx.font = `500 28px ${PRINT}`; ctx.fillText(label, xs[i] + colW(key) / 2, top + 45);
    });
    rows.forEach((r, j) => {
      const y = top + 70 + j * 70;
      format.labels.forEach(([, key], i) => {
        ctx.strokeRect(xs[i], y, colW(key), 70);
        hand(ctx, cellText(key, r.values[key]), xs[i] + colW(key) / 2, y + 31, colW(key), font, ink);
      });
    });
  }
  return c;
}

function noise(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// スマホで撮った写真の見た目：机の上で少し傾き、片側が暗い
function asPhoto(paper) {
  const W = Math.round(paper.width * 1.08), H = Math.round(paper.height * 1.12);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#6d5e4c"; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(jit(0.02) + 0.012);
  ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 24;
  ctx.drawImage(paper, -paper.width / 2, -paper.height / 2);
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "rgba(255,250,235,.10)"); g.addColorStop(1, "rgba(30,20,10,.28)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 14);
  // 長い辺 2400px に縮める（スマホの写真を画面で縮めたくらい）
  const s = Math.min(1, 2400 / Math.max(W, H));
  const out = document.createElement("canvas"); out.width = Math.round(W * s); out.height = Math.round(H * s);
  out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// 悪条件の写真：暗い現場で斜めから撮り、少しぶれて、画素も少ない（長い辺 1400px・JPEG の画質も低め）
function asHardPhoto(paper) {
  const W = Math.round(paper.width * 1.15), H = Math.round(paper.height * 1.2);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#4a3f33"; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.transform(1, 0.035, -0.06, 0.96, 0, 0); // 斜めから撮った歪み
  ctx.rotate(-0.045);
  ctx.filter = "blur(1.6px) brightness(0.78) contrast(0.85)";
  ctx.drawImage(paper, -paper.width / 2, -paper.height / 2);
  ctx.restore();
  const g = ctx.createRadialGradient(W * 0.25, H * 0.2, 50, W * 0.6, H * 0.6, Math.max(W, H));
  g.addColorStop(0, "rgba(255,240,210,.12)"); g.addColorStop(1, "rgba(0,0,0,.45)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 26);
  const s = Math.min(1, 1400 / Math.max(W, H));
  const out = document.createElement("canvas"); out.width = Math.round(W * s); out.height = Math.round(H * s);
  out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// 限界の写真：さらにぶれて暗く、画素も少ない（長い辺 1000px）。読めない欄が誤りでなく「要確認」になるかを見る
function asExtremePhoto(paper) {
  const c = asHardPhoto(paper);
  const s = 1000 / Math.max(c.width, c.height);
  const out = document.createElement("canvas"); out.width = Math.round(c.width * s); out.height = Math.round(c.height * s);
  const ctx = out.getContext("2d");
  ctx.filter = "blur(1.4px) brightness(0.85)";
  ctx.drawImage(c, 0, 0, out.width, out.height);
  ctx.filter = "none";
  noise(ctx, out.width, out.height, 20);
  return out;
}

// スキャナで取った PDF の見た目：まっすぐ、白く、少しざらつく灰色
function asScan(paper) {
  const c = document.createElement("canvas"); c.width = paper.width; c.height = paper.height;
  const ctx = c.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.15) brightness(1.04)";
  ctx.drawImage(paper, 0, 0);
  ctx.filter = "none";
  noise(ctx, c.width, c.height, 8);
  return c;
}

let XLSX;
function toExcel(format, rows) {
  const across = format.layout === "dates_across";
  const val = (key, v) => {
    if (v == null) return null;
    if (key === "date") return new Date(`${v}T00:00:00`);
    if (key === "tank") return `${v}号`;
    return v;
  };
  const head = [[`${format.title}${format.tanks.length === 1 ? `　${format.tanks[0]}号タンク` : ""}`], ["2026年"], []];
  const body = across
    ? format.labels.map(([label, key]) => [label, ...rows.map(r => val(key, r.values[key]))])
    : [format.labels.map(([label]) => label), ...rows.map(r => format.labels.map(([, key]) => val(key, r.values[key])))];
  const ws = XLSX.utils.aoa_to_sheet([...head, ...body], { cellDates: true, dateNF: "m/d" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "経過簿");
  return "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

function toPdf(scan) {
  const { jsPDF } = window.jspdf;
  const landscape = scan.width > scan.height;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth() - 16, ph = pdf.internal.pageSize.getHeight() - 16;
  const s = Math.min(pw / scan.width, ph / scan.height);
  pdf.addImage(scan.toDataURL("image/jpeg", 0.85), "JPEG", 8, 8, scan.width * s, scan.height * s);
  return pdf.output("datauristring");
}

async function main() {
  XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  for (const [f] of HANDS) await document.fonts.load(f, "0123456789.▲-/号泡地岩高水筋落玉追暖気上槽重い早香り立ち");
  const season = await fetch("/data/season-current.json").then(r => r.json());
  const truth = {};
  for (const [i, format] of FORMATS.entries()) {
    seed = 1000 + i * 77;
    const rows = sheetRows(format, season);
    truth[format.id] = { name: format.name, layout: format.layout, labels: format.labels, rows };
    const [font] = HANDS[i % HANDS.length];
    const paper = drawPaper(format, rows, font, INK[i % INK.length]);
    const photo = asPhoto(paper), scan = asScan(paper);
    document.getElementById("out").append(Object.assign(document.createElement("h2"), { textContent: format.name }), photo);
    await save(`${format.id}.jpg`, photo.toDataURL("image/jpeg", 0.88));
    await save(`${format.id}.pdf`, toPdf(scan));
    await save(`${format.id}.xlsx`, toExcel(format, rows));
    // 悪条件の写真（字の揺れを大きくして描き直す）
    MESSY = 2.6; seed = 5000 + i * 31;
    const hard = asHardPhoto(drawPaper(format, rows, font, "#3a3f55"));
    MESSY = 1;
    await save(`${format.id}-hard.jpg`, hard.toDataURL("image/jpeg", 0.6));
    MESSY = 3.2; seed = 9000 + i * 13;
    const extreme = asExtremePhoto(drawPaper(format, rows, font, "#4a4f62"));
    MESSY = 1;
    await save(`${format.id}-extreme.jpg`, extreme.toDataURL("image/jpeg", 0.5));
    log(`${format.id}：${rows.length}日分（${format.tanks.join("・")}号）`);
  }
  await save("truth.json", "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(truth, null, 1)))));
  window.sheetsDone = true;
  log("できました");
}
main().catch(e => { log(`エラー：${e.message}`); console.error(e); });
