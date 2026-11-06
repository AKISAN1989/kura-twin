// フローB：変化の検知と、杜氏への質問。検知はプログラム、質問の文だけ Claude（4-2）が作る。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc } from "../api.js";
import { attachMic } from "../speech.js";
import * as bridge from "../bridge.js";

const $ = id => document.getElementById(id);
const asking = new Set(); // 質問を作っている途中の eventId
const failed = new Map(); // eventId → エラー文
const drafts = new Map(); // eventId → 書きかけの答え（再描画で消さない）

function answeredIds() {
  return new Set(store.savedMemos.map(m => m.id));
}

function contextRecords(event) {
  const tank = app.tank(event.tank);
  return tank.records.filter(r => r.moromi_day != null && Math.abs(r.moromi_day - event.moromi_day) <= 3 && r.date <= app.date);
}

async function makeQuestion(event) {
  if (asking.has(event.id)) return;
  asking.add(event.id);
  failed.delete(event.id);
  render();
  try {
    const { question } = await postJson("ask-toji", {
      event, records: contextRecords(event), kind: app.tank(event.tank).kind,
    });
    store.saveQuestion(event.id, question);
  } catch (e) {
    failed.set(event.id, e.message);
  } finally {
    asking.delete(event.id);
    render();
  }
}

function saveAnswer(event, answer) {
  const memo = {
    id: event.id, season: app.season, tank: event.tank, date: event.date, moromi_day: event.moromi_day,
    rule: event.rule, change: event.change, question: store.questions[event.id].question,
    answer: answer.trim(), answered_at: new Date().toISOString(),
  };
  if (!store.saveMemo(memo)) alert("この端末に保存できませんでした（ブラウザの保存が使えない設定です）");
  drafts.delete(event.id);
  app.emit("memo-saved");
}

function card(event, isToday) {
  const q = store.questions[event.id]?.question;
  const label = app.tankLabel(event.tank);
  let body;
  if (q) {
    body = `<p class="question">${esc(q)}</p>
      <textarea rows="3" data-answer="${esc(event.id)}" placeholder="杜氏の答え（文字か声で）">${esc(drafts.get(event.id) ?? "")}</textarea>
      <div class="row"><button type="button" class="primary" data-save="${esc(event.id)}">判断メモとして保存</button>
      <button type="button" class="mic" data-mic="${esc(event.id)}" hidden>🎤 声で入力</button></div>`;
  } else if (asking.has(event.id)) {
    body = `<p class="muted">Claude が質問をつくっています…</p>`;
  } else if (failed.has(event.id)) {
    body = `<div class="error">${esc(failed.get(event.id))} <button type="button" data-ask="${esc(event.id)}">再実行</button></div>`;
  } else {
    body = `<button type="button" data-ask="${esc(event.id)}">質問をつくる</button>`;
  }
  return `<article class="card ${isToday ? "" : "older"}">
    <header><button type="button" class="link" data-look="${esc(event.tank)}">${esc(label)}</button>
      <span class="muted">${esc(event.date.slice(5).replace("-", "/"))} 日順${event.moromi_day}${isToday ? "" : "（未回答）"}</span></header>
    <p class="change">${esc(event.change)}</p>
    ${body}
  </article>`;
}

function render() {
  const box = $("tab-toji");
  if (app.tab !== "toji") return;
  // 書きかけの答えを退避
  box.querySelectorAll("[data-answer]").forEach(t => drafts.set(t.dataset.answer, t.value));

  if (!app.isCurrent) {
    const memos = store.allMemos().filter(m => m.season === app.season).sort((a, b) => a.date.localeCompare(b.date));
    box.innerHTML = `<p class="muted">${esc(app.season)}年の判断メモ（杜氏への質問は今季だけ）。</p>
      ${memos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">${esc(app.tankLabel(m.tank))}
        <span class="muted">${esc(m.date.slice(5).replace("-", "/"))} 日順${m.moromi_day}</span> ${esc(m.change)}</button>`).join("")}`;
    box.querySelectorAll("[data-memo]").forEach(b => { b.onclick = () => showMemoFn(store.allMemos().find(m => m.id === b.dataset.memo)); });
    return;
  }

  const answered = answeredIds();
  const all = app.eventsUpTo();
  const today = all.filter(e => e.date === app.date);
  const pending = all.filter(e => e.date !== app.date && !answered.has(e.id)).reverse();
  const todaysMemos = store.savedMemos.filter(m => m.date === app.date && m.season === app.season);

  box.innerHTML = `
    <p class="muted">決まったルールで見つけた変化に、Claude が1つずつ短く質問します。答えは判断メモとしてタンクと日付に結びつきます。</p>
    <h3>${esc(app.date.slice(5).replace("-", "/"))} の変化</h3>
    ${today.filter(e => !answered.has(e.id)).map(e => card(e, true)).join("") || `<p class="muted">この日の未回答の変化はありません。</p>`}
    ${todaysMemos.length ? `<h3>この日の判断メモ</h3>${todaysMemos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">${esc(app.tankLabel(m.tank))} ${esc(m.change)}</button>`).join("")}` : ""}
    ${pending.length ? `<h3>前の日の未回答</h3>${pending.map(e => card(e, false)).join("")}` : ""}
    <details class="rules"><summary>検知のルール</summary>
      <ul><li>品温：前日比 ${store.rules.temp_change.min_delta_c}℃以上の上げ下げ</li>
      <li>加水：操作・備考に「${store.rules.add_water.keywords.join("」「")}」</li>
      <li>停滞：日本酒度の変化が ${store.rules.stall.window_days}日間で ±${store.rules.stall.max_change}以内</li>
      <li>日順${store.rules.apply_from_moromi_day}から適用（web/public/config/rules.json で変更）</li></ul></details>`;

  box.querySelectorAll("[data-ask]").forEach(b => { b.onclick = () => makeQuestion(all.find(e => e.id === b.dataset.ask)); });
  box.querySelectorAll("[data-look]").forEach(b => { b.onclick = () => { app.selectTank(b.dataset.look); bridge.setCamera("toji", b.dataset.look); }; });
  box.querySelectorAll("[data-memo]").forEach(b => { b.onclick = () => showMemoFn(store.allMemos().find(m => m.id === b.dataset.memo)); });
  box.querySelectorAll("[data-save]").forEach(b => {
    b.onclick = () => {
      const t = box.querySelector(`[data-answer="${CSS.escape(b.dataset.save)}"]`);
      if (!t.value.trim()) { t.focus(); return; }
      saveAnswer(all.find(e => e.id === b.dataset.save), t.value);
    };
  });
  box.querySelectorAll("[data-mic]").forEach(b => attachMic(b, box.querySelector(`[data-answer="${CSS.escape(b.dataset.mic)}"]`)));

  // その日の変化には、Claude が自分から質問をつくる（1変化につき1回）
  for (const e of today) {
    if (!answered.has(e.id) && !store.questions[e.id] && !asking.has(e.id) && !failed.has(e.id)) makeQuestion(e);
  }
}

let showMemoFn = () => {};
export function initToji({ showMemo }) {
  showMemoFn = showMemo;
  app.onChange(kind => { if (kind !== "tank") render(); });
}
