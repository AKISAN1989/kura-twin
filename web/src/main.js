import * as bridge from "./bridge.js";
import { store } from "./store.js";
import { app } from "./app.js";
import { esc } from "./api.js";
import { tankChart } from "./chart.js";
import { initToji } from "./panels/toji.js";
import { initYoung } from "./panels/young.js";
import { initSummary } from "./panels/summary.js";
import { initImport } from "./panels/import.js";

const $ = id => document.getElementById(id);

// ---------- 3D（Unity版） ----------
// 3Dの上では、ページの拡大（トラックパッドのピンチ）・右クリックのメニュー・スクロールをさせず、蔵の操作に使う
function guardCanvas(canvas) {
  // 操作のヒント：スマホは指の言い方にし、いちど触ったら消す
  const hint = $("stage-hint");
  if (matchMedia("(pointer: coarse)").matches) hint.textContent = "指で回す・2本指で寄る・タンクを押して近づく";
  canvas.addEventListener("pointerdown", () => hint.classList.add("gone"), { once: true });
  canvas.addEventListener("wheel", e => e.preventDefault(), { passive: false });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
}
async function startUnity() {
  const base = "unity/Build/kura";
  const status = $("unity-status");
  const setText = t => { $("loader-text").textContent = t; };
  const fail = t => { status.classList.add("failed"); setText(t); };
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${base}.loader.js`;
      s.onload = resolve;
      s.onerror = () => reject(new Error("not-built"));
      document.body.appendChild(s);
    });
  } catch {
    fail("Unity版がまだ書き出されていません（web/public/unity/ に置くとここに表示されます）");
    return;
  }
  // 書き出しの版（毎回変わる）を URL に付け、新しい3Dを確実に読む
  const v = await fetch(`${base.replace(/kura$/, "")}version.txt`, { cache: "no-store" }).then(r => (r.ok ? r.text() : "")).catch(() => "");
  const q = v ? `?v=${encodeURIComponent(v.trim())}` : "";
  try {
    const instance = await window.createUnityInstance($("unity-canvas"), {
      // Brotli で圧縮した3D（.unityweb）。配信側が解凍しない場合は Unity の読み込み部が自分で解凍する
      dataUrl: `${base}.data.unityweb${q}`,
      frameworkUrl: `${base}.framework.js.unityweb${q}`,
      codeUrl: `${base}.wasm.unityweb${q}`,
      // ?capture=1 のときだけ、3Dの画面を画像として取り出せるようにする（README・動画の素材用）
      webglContextAttributes: { preserveDrawingBuffer: new URLSearchParams(location.search).has("capture") },
      companyName: "KuraTwin",
      productName: "KuraTwin",
      productVersion: "0.1",
    }, p => {
      $("loader-fill").style.width = `${Math.round(p * 100)}%`;
      setText(p < 0.9 ? `蔵の戸を開けています… ${Math.round(p * 100)}%` : "蔵を組み立てています…");
    });
    // 読み込みが終わったら、ふわっと消す
    status.classList.add("done");
    setTimeout(() => status.remove(), 700);
    bridge.attachUnity(instance);
    guardCanvas($("unity-canvas"));
  } catch (e) {
    fail(`3Dを表示できませんでした：${e.message ?? e}`);
  }
}

// 杜氏の吹き出し：Unity が頭の位置（画面の割合、y は下から）を毎フレーム知らせてくる
window.kuraOnTojiBubble = (text, x, y, visible) => {
  const el = $("toji-bubble");
  el.parentElement.classList.toggle("talking", !!(text && visible)); // 話しているあいだは操作のヒントを隠す
  if (!text || !visible) { el.hidden = true; return; }
  el.hidden = false;
  if (el.textContent !== text) el.textContent = text;
  const w = el.parentElement.clientWidth, h = el.parentElement.clientHeight;
  // 上の余白：カメラのボタンと日付の表示（狭い画面ではボタンの下にある）に重ならないように。入りきらない分はスクロール
  const badge = $("time-badge");
  const top = Math.max(56, badge && badge.textContent ? badge.offsetTop + badge.offsetHeight + 8 : 0);
  el.style.maxHeight = `${Math.max(60, h - top - 8)}px`;
  const bh = el.offsetHeight, bw = el.offsetWidth;
  if (h - y * h - top >= bh) {
    // 頭の上に置く（ふつう）
    el.classList.remove("side");
    el.style.transform = "";
    el.style.left = `${Math.min(0.75, Math.max(0.12, x)) * 100}%`;
    el.style.bottom = `${Math.max(8, y * h)}px`;
  } else {
    // 頭の上に入りきらないとき（杜氏の近くで止まったカメラなど）は、杜氏に重ならないよう頭の横に置く
    el.classList.add("side");
    el.style.transform = "none";
    const px = x * w, gap = 46;
    const left = px < w / 2 ? px + gap : px - gap - bw;
    el.style.left = `${Math.max(8, Math.min(w - bw - 8, left))}px`;
    el.style.bottom = `${Math.max(8, Math.min(y * h - bh * 0.6, h - bh - top))}px`;
  }
};
window.kuraOnUnityReady = () => { app.resend(); app.emit("unity-ready"); };

// ---------- 今と過去の表示（3Dの上） ----------
// 表示している日付と「今季／昨季」。過去へ移るときは、日付がさかのぼるように数字を動かす
let badgeShown = null; // { date, past }
let badgeTimer = null;
const md = d => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
function badgeText(date, past) {
  const y = date.slice(0, 4);
  if (!app.isCurrent) return `昨季（${app.season}年 仕込み）　${y}年${md(date)}の記録`;
  if (past) return `今季　${md(date)}の記録（判断メモ）`;
  return `今季（${app.season}年 仕込み）　${md(date)}${date === app.seasonData.today ? "（今日）" : ""}`;
}
function renderTimeBadge() {
  const el = $("time-badge");
  const date = app.date, past = app.isPast;
  el.classList.toggle("past", past);
  clearInterval(badgeTimer);
  if (!badgeShown || badgeShown.past === past || badgeShown.date === date) {
    el.textContent = badgeText(date, past);
    badgeShown = { date, past };
    return;
  }
  // 数秒かけて、前の日付から今の日付へ数字を動かす（3D の光と液面の移り変わりと同じ長さ）
  const from = Date.parse(badgeShown.date + "T00:00:00Z"), to = Date.parse(date + "T00:00:00Z");
  const start = performance.now(), dur = 2600;
  badgeShown = { date, past };
  badgeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const d = new Date(from + (to - from) * e).toISOString().slice(0, 10);
    el.textContent = t < 1 ? `${d.slice(0, 4)}年${md(d)}` : badgeText(date, past);
    if (t >= 1) clearInterval(badgeTimer);
  }, 50);
}

// ---------- 季・日付・タンク ----------
function renderDay() {
  $("day-slider").max = String(app.calendar.length - 1);
  $("day-slider").value = String(app.dayIndex);
  const d = app.date;
  $("day-label").textContent = `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日${app.isCurrent && d === app.seasonData.today ? "（今日）" : ""}`;
  document.body.classList.toggle("past", app.isPast); // 今季は暖かい色、過去は青みのある色（左の3Dと揃える）
  renderTankButtons();
  renderTankDetail();
}

function renderTankButtons() {
  const events = new Set(app.eventsOn().map(e => e.tank));
  $("tank-buttons").innerHTML = store.kura.tanks.map(t => {
    const cls = [app.selected === t.id ? "on" : "", events.has(t.id) ? "alert" : ""].join(" ");
    return `<button type="button" data-id="${t.id}" class="${cls}" title="${events.has(t.id) ? "変化あり" : ""}">${esc(t.label)}</button>`;
  }).join("");
}

function renderTankDetail() {
  const box = $("tank-detail");
  const id = app.selected;
  $("tank-summary").hidden = !id;
  if (!id) { box.hidden = true; return; }
  box.hidden = false;
  const tank = app.tank(id);
  const recs = tank.records.filter(r => r.date <= app.date);
  const today = recs[recs.length - 1];
  const memos = store.memosFor(app.season, id).filter(m => m.date <= app.date);
  const eventDays = app.eventsUpTo().filter(e => e.tank === id).map(e => e.moromi_day);
  const state = !today ? "まだ仕込み前"
    : today.operation === "上槽" ? `${today.date.slice(5).replace("-", "/")} 上槽`
    : today.moromi_day >= 1 ? `留添${today.moromi_day}日目` : today.operation;
  box.innerHTML = `
    <div class="detail-head"><strong>${esc(app.tankLabel(id))}</strong> <span class="meta">${esc(tank.kind)}・${esc(state)}</span>
      <button type="button" class="link" id="detail-close">閉じる</button></div>
    ${tankChart(recs, { memoDays: memos.map(m => m.moromi_day), eventDays })}
    <div class="memos">
      ${memos.length ? memos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">
          <span class="muted">${esc(m.date.slice(5).replace("-", "/"))} 日順${m.moromi_day}</span> ${esc(m.change)}</button>`).join("")
        : `<p class="muted small">このタンクの判断メモはまだありません。</p>`}
    </div>`;
  $("detail-close").onclick = () => { app.selectTank(null); bridge.setCamera("overview"); };
  box.querySelectorAll("[data-memo]").forEach(b => {
    b.onclick = () => showMemo(store.allMemos().find(m => m.id === b.dataset.memo));
  });
}

/** 判断メモ：カメラを杜氏の目線に移し、その日の状態とメモを一緒に見せる */
function showMemo(memo) {
  if (!memo) return;
  document.querySelectorAll(".memo-dialog[open]").forEach(d => d.close());
  app.openMemo(memo);
  const tank = app.tank(memo.tank);
  const rec = tank?.records.find(r => r.date === memo.date);
  const dlg = document.createElement("dialog");
  dlg.className = "memo-dialog";
  dlg.innerHTML = `
    <h3>${esc(memo.season)}年 ${esc(app.tankLabel(memo.tank))} ${esc(memo.date)}（日順${memo.moromi_day}）</h3>
    <p class="muted">その日の経過簿：品温 ${rec?.temp ?? "-"}℃／日本酒度 ${rec?.nihonshudo ?? "-"}／ボーメ ${rec?.baume ?? "-"}／アルコール分 ${rec?.alcohol ?? "-"}%／状ぼう ${esc(rec?.joubou ?? "-")}／操作 ${esc(rec?.operation ?? "-")}／備考 ${esc(rec?.note ?? "-")}</p>
    <p><strong>変化：</strong>${esc(memo.change)}</p>
    <p><strong>質問：</strong>${esc(memo.question)}</p>
    <p class="answer"><strong>杜氏：</strong>${esc(memo.answer)}</p>
    ${memo.draft ? `<p class="muted">※ 作者が書いた下書きの判断メモ（架空）</p>` : ""}
    <form method="dialog"><button>閉じる</button></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => {
    dlg.remove();
    // 別のメモに切り替えたとき（閉じる知らせは後から届く）は、カメラも「今」も戻さない
    if (document.querySelector(".memo-dialog[open]")) return;
    bridge.setCamera("overview");
    app.closeMemo();
  });
  dlg.show(); // 3Dの杜氏の目線が見えるよう、画面全体は覆わない
}

function initTabs() {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  tabs.forEach(b => {
    b.onclick = () => {
      app.tab = b.dataset.tab;
      // 杜氏のタブだけ、日付・タンク・グラフを隠して質問に絞る（年配の杜氏がスマホでも迷わないように）
      document.body.classList.toggle("toji-mode", app.tab === "toji");
      tabs.forEach(t => t.setAttribute("aria-selected", String(t === b)));
      document.querySelectorAll(".tab-body").forEach(s => { s.hidden = s.id !== `tab-${app.tab}`; });
      app.emit("tab");
    };
  });
}

async function main() {
  await store.load();
  $("kura-name").textContent = store.kura.name;
  $("season-select").innerHTML = Object.keys(store.seasons).sort().reverse()
    .map(s => `<option value="${s}">${s}年 仕込み${s === store.currentSeason ? "（今季）" : "（前季）"}</option>`).join("");
  $("season-select").onchange = e => app.setSeason(e.target.value);
  $("day-slider").addEventListener("input", e => app.setDayIndex(Number(e.target.value)));
  $("tank-buttons").addEventListener("click", e => {
    const id = e.target.closest("button")?.dataset.id;
    if (id) app.selectTank(app.selected === id ? null : id);
  });
  bridge.onTankClicked(id => app.selectTank(id));
  $("cam-overview").onclick = () => bridge.setCamera("overview");
  $("cam-toji").onclick = () => bridge.setCamera("toji", app.selected ?? store.kura.tanks[0].id);
  $("reset-local").onclick = () => {
    if (confirm("この端末に保存した取り込み結果・判断メモ・質問を消します。よろしいですか？")) {
      store.resetLocal();
      location.reload();
    }
  };

  app.onChange(kind => {
    if (kind === "season") $("season-select").value = app.season;
    if (kind !== "tab") renderDay();
    if (kind !== "tab") renderTimeBadge();
  });
  initTabs();
  document.body.classList.toggle("toji-mode", app.tab === "toji");
  initToji({ showMemo });
  initYoung({ showMemo });
  initSummary({ showMemo });
  initImport();

  app.setSeason(store.currentSeason);
  startUnity();
}

main().catch(e => {
  if ($("loader-text")) $("loader-text").textContent = e.message;
  console.error(e);
});
