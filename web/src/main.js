import * as bridge from "./bridge.js";
import { allTanksOn, seasonCalendar } from "./tank-state.js";

const $ = id => document.getElementById(id);
const TEMP_RANGE = { tempMin: 6, tempMax: 14 }; // 液面の色：6℃＝青 〜 14℃＝赤

const state = { kura: null, season: null, calendar: [], dayIndex: 0, selected: null, highlighted: new Set() };

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

function applyDay() {
  const date = state.calendar[state.dayIndex];
  $("day-label").textContent = date.replaceAll("-", "/");
  bridge.setDay({
    dayIndex: state.dayIndex,
    date,
    ...TEMP_RANGE,
    // Unity の JsonUtility は null を読めないので、品温が無いときは -999 を送る
    tanks: allTanksOn(state.season, date, state.kura.tank_capacity_l)
      .map(t => ({ ...t, temp: t.temp ?? -999, joubou: t.joubou ?? "" })),
  });
}

function renderTankButtons() {
  $("tank-buttons").innerHTML = state.kura.tanks
    .map(t => `<button data-id="${t.id}" class="${state.selected === t.id ? "on" : ""}">${t.label}</button>`)
    .join("");
}

function selectTank(id) {
  state.selected = state.selected === id ? null : id;
  bridge.selectTank(state.selected);
  renderTankButtons();
}

async function startUnity() {
  const base = "unity/Build/kura";
  const status = $("unity-status");
  const loaderUrl = `${base}.loader.js`;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = loaderUrl;
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
      dataUrl: `${base}.data`,
      frameworkUrl: `${base}.framework.js`,
      codeUrl: `${base}.wasm`,
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
  el.style.bottom = `${y * 100}%`;
};

// Unity 側の準備ができたら呼ばれる（KuraBridge.cs の Start から）
window.kuraOnUnityReady = () => {
  applyDay();
  if (state.selected) bridge.selectTank(state.selected);
  state.highlighted.forEach(id => bridge.highlightTank(id, true));
};

async function main() {
  [state.kura, state.season] = await Promise.all([
    loadJson("data/kura.json"),
    loadJson("data/season-current.json"),
  ]);
  $("kura-name").textContent = `${state.kura.name}（${state.season.season}年 仕込み）`;
  state.calendar = seasonCalendar(state.season);
  state.dayIndex = state.calendar.length - 1;
  const slider = $("day-slider");
  slider.max = String(state.calendar.length - 1);
  slider.value = String(state.dayIndex);
  slider.addEventListener("input", () => { state.dayIndex = Number(slider.value); applyDay(); });

  renderTankButtons();
  $("tank-buttons").addEventListener("click", e => {
    const id = e.target.closest("button")?.dataset.id;
    if (id) selectTank(id);
  });
  bridge.onTankClicked(id => selectTank(id));

  $("cam-overview").onclick = () => bridge.setCamera("overview");
  $("cam-toji").onclick = () => bridge.setCamera("toji", state.selected ?? state.kura.tanks[0].id);
  $("hl-toggle").onclick = () => {
    const id = state.selected ?? "3";
    const on = !state.highlighted.has(id);
    on ? state.highlighted.add(id) : state.highlighted.delete(id);
    bridge.highlightTank(id, on);
  };
  $("toji-say").onclick = () => bridge.tojiSay($("toji-text").value);

  applyDay();
  startUnity();
}

main().catch(e => {
  $("unity-status").textContent = e.message;
  console.error(e);
});
