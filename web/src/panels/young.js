// フローC：蔵人の質問。候補の抽出はプログラム、回答（4-3）と照合（4-5）は Claude。
// 杜氏とのチャットの見た目で、いちばん新しい答えを左の3Dの杜氏が語る（根拠のタンクまで歩いて案内する）。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc } from "../api.js";
import { attachMic } from "../speech.js";
import { parseQuestion, rankMemos } from "../similar.js";
import * as bridge from "../bridge.js";

const $ = id => document.getElementById(id);
let showMemoFn = () => {};
const log = []; // { q, state: "thinking" | "done" | "error", res, candidates, error }

const SUGGEST = [
  "追水したのはどんなとき？",
  "留添12日目に日本酒度が止まったとき、どうしてた？",
  "品温を下げたのはなぜ？",
];

async function ask(text) {
  const question = (text ?? $("young-q").value).trim();
  if (!question) { $("young-q").focus(); return; }
  $("young-q").value = "";
  const item = { q: question, state: "thinking", candidates: rankMemos(parseQuestion(question), store.allMemos(), store.seasons, 3) };
  log.push(item);
  render();
  $("young-ask").disabled = true;
  try {
    item.res = await postJson("young-question", { question, candidates: item.candidates });
    item.state = "done";
    render();
    showIn3D(item.res);
  } catch (e) {
    item.state = "error";
    item.error = e.message;
    render();
  } finally {
    $("young-ask").disabled = false;
  }
}

// 3Dで：当時の日付に戻し（時を巻き戻す）、杜氏が根拠のタンクの前まで歩いて語る
function showIn3D(res) {
  if (!res.found) { bridge.tojiSay(res.answer); return; }
  const first = res.sources[0];
  if (first) {
    if (first.season !== app.season || first.date !== app.date) app.setSeason(first.season, first.date);
    app.selectTank(first.tank);
  }
  bridge.tojiSay(res.answer, first?.tank ?? null);
}

const memoOf = s => store.allMemos().find(m => m.season === s.season && m.tank === s.tank && m.date === s.date);

function tojiMsg(inner, cls = "") {
  return `<div class="msg toji ${cls}"><div class="avatar" aria-hidden="true">杜</div><span class="who">杜氏</span>${inner}</div>`;
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
    return tojiMsg(`<div class="text">${esc(res.answer)}</div>
      <span class="muted small">記録にないことは推測で答えません。</span>${removedHtml(res.removed)}`);
  }
  const sources = res.sources.map(s => {
    const m = memoOf(s);
    return `<button type="button" ${m ? `data-memo="${esc(m.id)}"` : `data-src="${esc(JSON.stringify(s))}"`}>
      ${esc(s.season)}年 ${esc(app.tankLabel(s.tank))}・${esc(s.date.slice(5).replace("-", "/"))}</button>`;
  }).join("");
  // 核心（3〜4文）だけを見せ、数値の経過や他のタンクの例は「詳しく見る」で開く
  const detail = res.detail ? `<details class="more"><summary>詳しく見る</summary><p>${esc(res.detail)}</p></details>` : "";
  return tojiMsg(`<div class="text">${esc(res.answer)}${detail}</div>
    <div class="sources" aria-label="根拠の記録">${sources}</div>
    ${removedHtml(res.removed)}`);
}

function render() {
  const out = $("young-out");
  const greet = tojiMsg(`<div class="text">お前さんの問いには、昔の判断メモと経過簿だけを見て答える。記録にないことは言わんぞ。</div>`);
  out.innerHTML = greet + log.map((item, i) =>
    `<div class="msg me"><span class="who">蔵人</span><div class="text">${esc(item.q)}</div></div>${answerHtml(item, i)}`).join("");
  // 例の質問：はじめての人が迷わないように（まだ何も聞いていないときだけ）
  $("young-suggest").innerHTML = log.length ? "" : SUGGEST.map(q => `<button type="button">${esc(q)}</button>`).join("");
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
    b.onclick = () => { const [item] = log.splice(Number(b.dataset.retry), 1); ask(item.q); };
  });
  // 新しいやりとりが見えるように
  const last = out.lastElementChild;
  if (last && app.tab === "young") last.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
  render();
}
