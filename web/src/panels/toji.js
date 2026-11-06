// フローB：変化の検知と、杜氏への質問。検知はプログラム、質問の文だけ Claude（4-2）が作る。
// 年配の杜氏がスマホでも迷わないよう、今日の質問を1つずつ大きく出し、声で答えるのを主にする。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc } from "../api.js";
import { attachMic, speechAvailable } from "../speech.js";
import * as bridge from "../bridge.js";

const $ = id => document.getElementById(id);
const asking = new Set(); // 質問を作っている途中の eventId
const failed = new Map(); // eventId → エラー文
const drafts = new Map(); // eventId → 書きかけの答え（再描画で消さない）
const later = new Set(); // 「あとで答える」を押した eventId（今日のうちは後回し）
let focused = null; // 3Dで寄っているタンク
let showMemoFn = () => {};

function answeredIds() {
  return new Set(store.savedMemos.map(m => m.id));
}

function contextRecords(event) {
  const tank = app.tank(event.tank);
  return tank.records.filter(r => r.moromi_day != null && Math.abs(r.moromi_day - event.moromi_day) <= 3 && r.date <= event.date);
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

// 左の3Dを、今答えているタンクに寄せる（杜氏の目線）
function focus3D(tankId) {
  if (focused === tankId) return;
  focused = tankId;
  if (tankId == null) { bridge.selectTank(null); bridge.setCamera("overview"); return; }
  bridge.selectTank(tankId);
  bridge.setCamera("toji", tankId);
}

// 今日の質問：1つだけを大きく
function questionCard(event, rest) {
  const q = store.questions[event.id]?.question;
  const older = event.date !== app.date;
  let body;
  if (q) {
    body = `<p class="ask-question">${esc(q)}</p>
      <button type="button" class="btn-voice" data-mic hidden>🎤 声で答える</button>
      ${speechAvailable ? "" : `<p class="ask-note">この端末では声の入力が使えません。下に文字で書いてください。</p>`}
      <label class="ask-text-label" for="ask-answer">${speechAvailable ? "文字で書く・直す" : "答え"}</label>
      <textarea id="ask-answer" rows="3" class="ask-text" placeholder="ひとことで大丈夫です">${esc(drafts.get(event.id) ?? "")}</textarea>
      <button type="button" class="btn-save" data-save disabled>この答えを残す</button>
      <button type="button" class="btn-later" data-later>あとで答える</button>`;
  } else if (failed.has(event.id)) {
    body = `<div class="error">${esc(failed.get(event.id))}</div><button type="button" class="btn-save" data-ask>もう一度</button>`;
  } else {
    body = `<p class="ask-question waiting typing">質問をつくっています</p>`;
  }
  return `<article class="ask-card">
    <div class="ask-progress"><span>${older ? `前の日の質問（${Number(event.date.slice(5, 7))}月${Number(event.date.slice(8, 10))}日）` : "今日の質問"}</span><strong>残り${rest}問</strong></div>
    <h3 class="ask-tank">${esc(app.tankLabel(event.tank))}<small>${esc(event.change)}</small></h3>
    ${body}
  </article>`;
}

function render() {
  const box = $("tab-toji");
  if (app.tab !== "toji") return;
  const ta = box.querySelector("#ask-answer");
  if (ta?.dataset.event) drafts.set(ta.dataset.event, ta.value); // 書きかけの答えを退避

  // 昨季：杜氏が残した判断メモの一覧
  if (!app.isCurrent) {
    focus3D(null);
    const memos = store.allMemos().filter(m => m.season === app.season).sort((a, b) => a.date.localeCompare(b.date));
    box.innerHTML = `<p class="lead">${esc(app.season)}年に杜氏が残した判断メモ</p>
      ${memos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">${esc(app.tankLabel(m.tank))}
        <span class="muted">${esc(m.date.slice(5).replace("-", "/"))} 日順${m.moromi_day}</span> ${esc(m.change)}</button>`).join("")}`;
    box.querySelectorAll("[data-memo]").forEach(b => { b.onclick = () => showMemoFn(store.allMemos().find(m => m.id === b.dataset.memo)); });
    return;
  }

  // 今季：今日の変化への質問を1つずつ。そのあとに、前の日に答えなかった質問を並べる
  const answered = answeredIds();
  const today = app.eventsOn().filter(e => !answered.has(e.id));
  const older = app.eventsUpTo().filter(e => e.date !== app.date && !answered.has(e.id)).reverse(); // 新しい日から
  const all = [...today, ...older];
  const queue = [...all.filter(e => !later.has(e.id)), ...all.filter(e => later.has(e.id))];
  const doneCount = app.eventsOn().length - today.length;
  const current = queue[0];

  if (!current) {
    focus3D(null);
    box.innerHTML = `<div class="ask-done">
      <p class="ask-done-title">今日の質問は終わりです。<br>ありがとうございました。</p>
      ${doneCount ? `<p class="ask-done-sub">今日 ${doneCount}件の判断メモを残しました。</p>` : `<p class="ask-done-sub">今日は聞くことはありません。</p>`}
    </div>`;
    return;
  }

  box.innerHTML = questionCard(current, queue.length);
  focus3D(current.tank);

  const answer = box.querySelector("#ask-answer");
  const save = box.querySelector("[data-save]");
  if (answer) {
    answer.dataset.event = current.id;
    const sync = () => { save.disabled = !answer.value.trim(); drafts.set(current.id, answer.value); };
    answer.addEventListener("input", sync);
    sync();
    attachMic(box.querySelector("[data-mic]"), answer, { idle: "🎤 声で答える", active: "■ 話し終えた" });
    save.onclick = () => {
      if (!answer.value.trim()) { answer.focus(); return; }
      later.delete(current.id);
      saveAnswer(current, answer.value);
    };
    box.querySelector("[data-later]").onclick = () => {
      later.add(current.id);
      // 後回しにしたものを列の最後へ（1問だけのときはそのまま）
      if (queue.length > 1) { later.delete(queue[1].id); }
      render();
    };
  }
  box.querySelector("[data-ask]")?.addEventListener("click", () => makeQuestion(current));

  // 今日の変化と、いま出している質問・次の質問には、Claude が自分から質問をつくる（1変化につき1回）
  for (const e of [...today, ...queue.slice(0, 2)]) {
    if (!store.questions[e.id] && !asking.has(e.id) && !failed.has(e.id)) makeQuestion(e);
  }
}

export function initToji({ showMemo }) {
  showMemoFn = showMemo;
  app.onChange(kind => {
    if (kind === "tank") return;
    if (kind === "tab" && app.tab !== "toji") focused = null; // 他のタブへ移ったら、次に戻ったときにまた寄る
    if (kind === "unity-ready") focused = null; // 3Dの読み込みより前に寄せた分を、読み込み後にもう一度送る
    render();
  });
}
