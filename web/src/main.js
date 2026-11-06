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
async function startUnity() {
  const base = "unity/Build/kura";
  const status = $("unity-status");
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${base}.loader.js`;
      s.onload = resolve;
      s.onerror = () => reject(new Error("not-built"));
      document.body.appendChild(s);
    });
  } catch {
    status.textContent = "Unity版がまだ書き出されていません（web/public/unity/ に置くとここに表示されます）";
    return;
  }
  try {
    const instance = await window.createUnityInstance($("unity-canvas"), {
      // Brotli で圧縮した3D（.unityweb）。配信側が解凍しない場合は Unity の読み込み部が自分で解凍する
      dataUrl: `${base}.data.unityweb`,
      frameworkUrl: `${base}.framework.js.unityweb`,
      codeUrl: `${base}.wasm.unityweb`,
      // ?capture=1 のときだけ、3Dの画面を画像として取り出せるようにする（README・動画の素材用）
      webglContextAttributes: { preserveDrawingBuffer: new URLSearchParams(location.search).has("capture") },
      companyName: "KuraTwin",
      productName: "KuraTwin",
      productVersion: "0.1",
    }, p => { status.textContent = `3Dを読み込んでいます… ${Math.round(p * 100)}%`; });
    status.remove();
    bridge.attachUnity(instance);
  } catch (e) {
    status.textContent = `3Dを表示できませんでした：${e.message ?? e}`;
  }
}

// 杜氏の吹き出し：Unity が頭の位置（画面の割合、y は下から）を毎フレーム知らせてくる
window.kuraOnTojiBubble = (text, x, y, visible) => {
  const el = $("toji-bubble");
  if (!text || !visible) { el.hidden = true; return; }
  el.hidden = false;
  if (el.textContent !== text) el.textContent = text;
  el.style.left = `${Math.min(0.75, Math.max(0.12, x)) * 100}%`;
  // 長い答えでも、3Dの枠の上端（カメラのボタンの下）からはみ出さないようにする
  const h = el.parentElement.clientHeight;
  el.style.bottom = `${Math.max(8, Math.min(y * h, h - el.offsetHeight - 56))}px`;
};
window.kuraOnUnityReady = () => app.resend();

// ---------- 季・日付・タンク ----------
function renderDay() {
  $("day-slider").max = String(app.calendar.length - 1);
  $("day-slider").value = String(app.dayIndex);
  const d = app.date;
  $("day-label").textContent = `${d.slice(5).replace("-", "/")}${app.isCurrent && d === app.seasonData.today ? "（今日）" : ""}`;
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
    <div class="detail-head"><strong>${esc(app.tankLabel(id))}</strong> <span class="muted">${esc(tank.kind)}・${esc(state)}</span>
      <button type="button" class="link" id="detail-close">閉じる</button></div>
    ${tankChart(recs, { memoDays: memos.map(m => m.moromi_day), eventDays })}
    <div class="memos">
      ${memos.length ? memos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">
          <span class="muted">${esc(m.date.slice(5).replace("-", "/"))} 日順${m.moromi_day}</span> ${esc(m.change)}</button>`).join("")
        : `<p class="muted">このタンクの判断メモはまだありません。</p>`}
    </div>`;
  $("detail-close").onclick = () => { app.selectTank(null); bridge.setCamera("overview"); };
  box.querySelectorAll("[data-memo]").forEach(b => {
    b.onclick = () => showMemo(store.allMemos().find(m => m.id === b.dataset.memo));
  });
}

/** 判断メモ：カメラを杜氏の目線に移し、その日の状態とメモを一緒に見せる */
function showMemo(memo) {
  if (!memo) return;
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
  dlg.addEventListener("close", () => { dlg.remove(); bridge.setCamera("overview"); });
  document.querySelectorAll(".memo-dialog[open]").forEach(d => d.close());
  dlg.show(); // 3Dの杜氏の目線が見えるよう、画面全体は覆わない
}

function initTabs() {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  tabs.forEach(b => {
    b.onclick = () => {
      app.tab = b.dataset.tab;
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
  });
  initTabs();
  initToji({ showMemo });
  initYoung({ showMemo });
  initSummary({ showMemo });
  initImport();

  app.setSeason(store.currentSeason);
  startUnity();
}

main().catch(e => {
  $("unity-status").textContent = e.message;
  console.error(e);
});
