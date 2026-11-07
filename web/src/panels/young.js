// フローC：蔵人の質問。候補の抽出はプログラム、回答（4-3）と照合（4-5）は Claude。
// 杜氏とのチャットの見た目で、いちばん新しい答えを左の3Dの杜氏が語る（根拠のタンクまで歩いて案内する）。
// 記録に見つからない問いは「杜氏に聞いてもらう」で杜氏の「判断を語る」の一覧へ送り、杜氏の答え（判断メモ）が届いたら知らせる。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc } from "../api.js";
import { attachMic } from "../speech.js";
import { rankMemos, memoWithContext, candidatesForQuestion } from "../similar.js";
import * as bridge from "../bridge.js";

const $ = id => document.getElementById(id);
let showMemoFn = () => {};
// { q, context, state: "thinking" | "done" | "error", res, candidates, error, askId }
const log = [];
const fresh = new Set(); // この表示のあいだ「新着」と出す、杜氏の答え（ask の id）

const SUGGEST = [
  "追水したのはどんなとき？",
  "留添12日目に日本酒度が止まったとき、どうしてた？",
  "品温を下げたのはなぜ？",
];
export const NOT_IN_RECORD = "それは記録にないな。わしに直接聞いてみい";
export const ANSWERED = "お前さんの問い、答えといたぞ";

const md = d => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const contextText = c => [app.tankLabel(c.tank), md(c.date), c.moromi_day >= 1 ? `留添${c.moromi_day}日目` : null].filter(Boolean).join("・");

// 文字の2つ組の重なり（蔵人が前に杜氏へ直接聞いた問いと、同じことを聞いているか）
function bigrams(t) {
  const s = t.replace(/[\s、。？?！!「」]/g, "");
  return new Set([...s].slice(0, -1).map((c, i) => c + s[i + 1]));
}
function sameQuestion(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return false;
  // 短いほうの問いの半分以上が重なれば、同じことを聞いているとみなす（言い回しの違いを許す。答えるかどうかは Claude と照合役が決める）
  const inter = [...A].filter(x => B.has(x)).length;
  return inter >= 3 && inter / Math.min(A.size, B.size) >= 0.5;
}

function findCandidates(question, context) {
  const pool = store.allMemos().filter(m => m.from !== "kurabito");
  // タンクから聞いたときは、その変化の種類・日順・タンクで探す。文で聞いたときは、言葉の重なりでも探す
  const ranked = context
    ? rankMemos({ day: context.moromi_day, rules: context.rule ? [context.rule] : [], tank: context.tank }, pool, store.seasons, 3)
    : candidatesForQuestion(question, pool, store.seasons, 3);
  // 前に杜氏へ直接聞いて答えてもらった問いと同じなら、その判断メモをいちばん先に
  const direct = store.savedMemos.filter(m => m.from === "kurabito" && sameQuestion(m.question, question))
    .map(m => memoWithContext(m, store.seasons));
  return [...direct, ...ranked].slice(0, 3);
}

async function ask(text, context = null) {
  const question = (text ?? $("young-q").value).trim();
  if (!question) { $("young-q").focus(); return; }
  if (text == null) $("young-q").value = "";
  // タンクと状況を添えた問いは、Claude にもその状況を文で渡す
  const full = context ? `${contextText(context)}、${context.change}。${question}` : question;
  // タンクから聞いたときは、そのときの判断メモが無くても、似た状況での過去の判断を答えてよい
  const apiQ = context ? `${full}（このときの判断メモが無ければ、同じような状況で杜氏がどうしていたか）` : full;
  const item = { q: question, full, context, state: "thinking", candidates: findCandidates(full, context) };
  log.push(item);
  render({ scroll: true });
  $("young-ask").disabled = true;
  try {
    item.res = await postJson("young-question", { question: apiQ, candidates: item.candidates });
    item.state = "done";
    render({ scroll: true });
    showIn3D(item.res);
  } catch (e) {
    item.state = "error";
    item.error = e.message;
    render({ scroll: true });
  } finally {
    $("young-ask").disabled = false;
  }
}

/** タンクを選んだときの「このとき杜氏はどうしてた？」：そのタンクと変化を添えて聞く */
export function askAbout(event) {
  const context = { season: app.season, tank: event.tank, date: event.date, moromi_day: event.moromi_day, change: event.change, rule: event.rule };
  ask("このとき杜氏はどうしてた？", context);
  requestAnimationFrame(() => $("tab-young").scrollIntoView({ block: "start", behavior: "smooth" }));
}

// 3Dで：当時の日付に戻し（時を巻き戻す）、杜氏が根拠のタンクの前まで歩いて語る
function showIn3D(res) {
  if (!res.found) { bridge.tojiSay(NOT_IN_RECORD); return; }
  const first = res.sources[0];
  if (first?.date) {
    if (first.season !== app.season || first.date !== app.date) app.setSeason(first.season, first.date);
    if (first.tank) app.selectTank(first.tank);
  }
  bridge.tojiSay(res.answer, first?.tank ?? null);
}

// 記録に見つからなかった問いを、杜氏の「判断を語る」の一覧へ送る
function sendToToji(item) {
  const id = `ask-${Date.now().toString(36)}`;
  const c = item.context;
  const ok = store.addAsk({
    id, season: store.currentSeason, question: item.full, short: item.q,
    context: c ? { tank: c.tank, date: c.date, moromi_day: c.moromi_day, change: c.change } : null,
    asked_at: new Date().toISOString(), seen: false,
  });
  if (!ok) alert("この端末に保存できませんでした（ブラウザの保存が使えない設定です）");
  item.askId = id;
  app.emit("ask-sent");
  render();
}

const memoOf = s => store.allMemos().find(m => m.season === s.season && m.tank === s.tank && m.date === s.date);
const sourceLabel = s => (s.tank ? `${s.season}年 ${app.tankLabel(s.tank)}・${s.date.slice(5).replace("-", "/")}` : `${s.season}年 杜氏に直接聞いた問い`);

function tojiMsg(inner, cls = "") {
  return `<div class="msg toji ${cls}"><div class="avatar" aria-hidden="true">杜</div><span class="who">杜氏</span>${inner}</div>`;
}
function meMsg(item) {
  const chip = item.context ? `<span class="ctx">${esc(contextText(item.context))}｜${esc(item.context.change)}</span>` : "";
  return `<div class="msg me"><span class="who">蔵人</span><div class="text">${chip}${esc(item.q)}</div></div>`;
}

// 杜氏に直接聞いた問いの、今の様子（送った・答えが届いた）
function askStatusHtml(askId) {
  const memo = store.answerOf(askId);
  if (!memo) return `<p class="ask-sent">杜氏の「判断を語る」の一覧に入れました。答えが届いたら、3Dの杜氏が知らせます。</p>`;
  return "";
}
function answeredHtml(a, memo) {
  return tojiMsg(`<div class="text">${fresh.has(a.id) ? `<span class="new">新着</span>` : ""}${esc(memo.answer)}</div>
    <span class="muted small">杜氏が直接答えた判断メモ（${esc(md(memo.date))}）</span>`, "direct");
}

function answerHtml(item, i) {
  if (item.state === "thinking") {
    return tojiMsg(`<div class="text typing">${item.candidates.length ? "記録を調べている" : "記録を探している"}</div>`, "thinking");
  }
  if (item.state === "error") {
    return tojiMsg(`<div class="text"><span class="error">${esc(item.error)}</span> <button type="button" data-retry="${i}">もう一度聞く</button></div>`);
  }
  const res = item.res;
  if (!res.found) {
    const a = item.askId && store.asks.find(x => x.id === item.askId);
    const memo = a && store.answerOf(a.id);
    return tojiMsg(`<div class="text">${esc(NOT_IN_RECORD)}</div>
      ${item.askId ? askStatusHtml(item.askId) : `<button type="button" class="btn-direct" data-direct="${i}">杜氏に聞いてもらう</button>`}
      <span class="muted small">記録にないことは推測で答えません。</span>${res.removed?.length ? removedHtml(res.removed) : ""}`)
      + (memo ? answeredHtml(a, memo) : "");
  }
  const sources = res.sources.map(s => {
    const m = memoOf(s);
    return `<button type="button" ${m ? `data-memo="${esc(m.id)}"` : `data-src="${esc(JSON.stringify(s))}"`}>${esc(sourceLabel(s))}</button>`;
  }).join("");
  // 核心（3〜4文）だけを見せ、数値の経過や他のタンクの例は「詳しく見る」で開く
  const detail = res.detail ? `<details class="more"><summary>詳しく見る</summary><p>${esc(res.detail)}</p></details>` : "";
  // タンクから聞いて、そのタンクのその日の判断メモが無く、似た状況の過去の判断で答えたとき：
  // その日のそのタンクの本当の理由を、杜氏に直接聞けるようにする
  const c = item.context;
  const similarOnly = c && !res.sources.some(s => s.season === c.season && s.tank === c.tank && s.date === c.date);
  const a = item.askId && store.asks.find(x => x.id === item.askId);
  const memo = a && store.answerOf(a.id);
  const direct = !similarOnly ? "" : item.askId ? askStatusHtml(item.askId)
    : `<div class="direct-row"><span class="muted small">${esc(app.tankLabel(c.tank))}のこの日の判断メモはまだありません。本当の理由は杜氏に聞けます。</span>
       <button type="button" class="btn-direct" data-direct="${i}">杜氏に聞いてもらう</button></div>`;
  return tojiMsg(`<div class="text">${esc(res.answer)}${detail}</div>
    <div class="sources" aria-label="根拠の記録">${sources}</div>
    ${removedHtml(res.removed)}${direct}`) + (memo ? answeredHtml(a, memo) : "");
}

// 前に杜氏へ直接聞いた問い（この表示のやりとりに無いもの）：答えが届いたものと、待っているもの
function earlierAsksHtml() {
  const inLog = new Set(log.map(i => i.askId).filter(Boolean));
  const asks = store.asks.filter(a => !inLog.has(a.id));
  if (!asks.length) return "";
  return asks.map(a => {
    const memo = store.answerOf(a.id);
    const me = `<div class="msg me"><span class="who">蔵人（杜氏に直接聞いた問い）</span><div class="text">${esc(a.question)}</div></div>`;
    return me + (memo ? answeredHtml(a, memo) : tojiMsg(`<p class="ask-sent">まだ答えを待っています（杜氏の「判断を語る」の一覧に入っています）</p>`, "waiting"));
  }).join("");
}

function render({ scroll = false } = {}) {
  const out = $("young-out");
  const greet = tojiMsg(`<div class="text">お前さんの問いには、昔の判断メモと経過簿だけを見て答える。記録にないことは言わんぞ。</div>`);
  out.innerHTML = greet + earlierAsksHtml() + log.map((item, i) => meMsg(item) + answerHtml(item, i)).join("");
  // 例の質問：何度でも選べるように、いつも出しておく
  $("young-suggest").innerHTML = SUGGEST.map(q => `<button type="button">${esc(q)}</button>`).join("");
  $("young-suggest").querySelectorAll("button").forEach(b => { b.onclick = () => ask(b.textContent); });

  out.querySelectorAll("[data-memo]").forEach(b => { b.onclick = () => showMemoFn(store.allMemos().find(m => m.id === b.dataset.memo)); });
  out.querySelectorAll("[data-src]").forEach(b => {
    b.onclick = () => {
      const s = JSON.parse(b.dataset.src);
      app.setSeason(s.season, s.date);
      app.selectTank(s.tank);
      bridge.setCamera("toji", s.tank);
    };
  });
  out.querySelectorAll("[data-retry]").forEach(b => {
    b.onclick = () => { const [item] = log.splice(Number(b.dataset.retry), 1); ask(item.q, item.context); };
  });
  out.querySelectorAll("[data-direct]").forEach(b => { b.onclick = () => sendToToji(log[Number(b.dataset.direct)]); });
  // 新しいやりとりが見えるように（質問したときだけ。開いただけではページを動かさない）
  const last = out.lastElementChild;
  if (scroll && last && app.tab === "young") last.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/**
 * 蔵人が開いたとき：杜氏が答えた問いでまだ知らせていないものがあれば、3Dの杜氏が「答えといたぞ」と語る。
 * 知らせた件数を返す
 */
export function announceAnswers() {
  const news = store.asks.filter(a => !a.seen && store.answerOf(a.id));
  if (!news.length) return 0;
  news.forEach(a => fresh.add(a.id));
  store.markAsksSeen(news.map(a => a.id));
  const tank = news[news.length - 1].context?.tank ?? null;
  bridge.tojiSay(ANSWERED, tank);
  render();
  return news.length;
}

function removedHtml(removed) {
  if (!removed?.length) return `<span class="verified">✓ 別の Claude が一文ずつ記録と照合済み</span>`;
  return `<details><summary>照合で削った文（${removed.length}件）</summary>
    <ul>${removed.map(r => `<li><s>${esc(r.text)}</s><br>${esc(r.reason)}</li>`).join("")}</ul></details>`;
}

export function initYoung({ showMemo }) {
  showMemoFn = showMemo;
  $("young-ask").onclick = () => ask();
  $("young-q").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); });
  attachMic($("young-mic"), $("young-q"));
  // 杜氏が答えを残したら（同じ端末で役割を切り替えたとき）、やりとりの表示を更新する
  app.onChange(kind => { if (kind === "memo-saved" || kind === "role" || kind === "synced") render(); });
  render();
}
