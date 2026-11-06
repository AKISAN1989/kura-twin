// フローC：若手の質問。候補の抽出はプログラム、回答（4-3）と照合（4-5）は Claude。杜氏のキャラクターが語る。
import { app } from "../app.js";
import { store } from "../store.js";
import { postJson, esc, errorBox } from "../api.js";
import { attachMic } from "../speech.js";
import { parseQuestion, rankMemos } from "../similar.js";
import * as bridge from "../bridge.js";

const $ = id => document.getElementById(id);
let showMemoFn = () => {};

async function ask() {
  const question = $("young-q").value.trim();
  const out = $("young-out");
  if (!question) { $("young-q").focus(); return; }
  const query = parseQuestion(question);
  const candidates = rankMemos(query, store.allMemos(), store.seasons, 3);
  out.innerHTML = `<p class="muted">${candidates.length ? `似た記録を${candidates.length}件見つけました。Claude が答えを書き、別の Claude が一文ずつ記録と照合しています…` : "似た記録を探しています…"}</p>`;
  $("young-ask").disabled = true;
  try {
    const res = await postJson("young-question", { question, candidates });
    render(res, candidates);
  } catch (e) {
    errorBox(out, e.message, ask);
  } finally {
    $("young-ask").disabled = false;
  }
}

function render(res, candidates) {
  const out = $("young-out");
  if (!res.found) {
    bridge.tojiSay(res.answer); // 記録が無いときは、その場で語る
    out.innerHTML = `<div class="answer-box"><p class="toji">${esc(res.answer)}</p>
      <p class="muted">推測では答えません。${candidates.length ? "候補の記録はありましたが、質問に答える内容がありませんでした。" : "条件の近い判断メモがありませんでした。"}</p>
      ${removedHtml(res.removed)}</div>`;
    return;
  }
  const memoOf = s => store.allMemos().find(m => m.season === s.season && m.tank === s.tank && m.date === s.date);
  const sources = res.sources.map(s => {
    const m = memoOf(s);
    return `<button type="button" class="memo-link" ${m ? `data-memo="${esc(m.id)}"` : `data-src="${esc(JSON.stringify(s))}"`}>
      ${esc(s.season)}年 ${esc(app.tankLabel(s.tank))} ${esc(s.date)}${m ? "（判断メモ）" : "（経過簿）"}</button>`;
  }).join("");
  out.innerHTML = `<div class="answer-box">
      <p class="toji">${res.sentences.map(s => esc(s.text)).join("")}</p>
      <h4>根拠</h4>${sources}
      ${removedHtml(res.removed)}
    </div>`;
  out.querySelectorAll("[data-memo]").forEach(b => { b.onclick = () => showMemoFn(store.allMemos().find(m => m.id === b.dataset.memo)); });
  out.querySelectorAll("[data-src]").forEach(b => {
    b.onclick = () => {
      const s = JSON.parse(b.dataset.src);
      app.setSeason(s.season, s.date);
      app.selectTank(s.tank);
      bridge.setCamera("toji", s.tank);
    };
  });
  // 3Dで、根拠のタンクを示す：当時の日付に戻し、杜氏がそのタンクの前まで歩いて語る
  const first = res.sources[0];
  if (first) {
    if (first.season !== app.season || first.date !== app.date) app.setSeason(first.season, first.date);
    app.selectTank(first.tank);
  }
  bridge.tojiSay(res.answer, first?.tank ?? null);
}

function removedHtml(removed) {
  if (!removed?.length) return `<p class="muted small">照合役の Claude：すべての文に記録の根拠がありました。</p>`;
  return `<details class="small"><summary>照合役の Claude が削った文（${removed.length}件）</summary>
    <ul>${removed.map(r => `<li><s>${esc(r.text)}</s><br><span class="muted">${esc(r.reason)}</span></li>`).join("")}</ul></details>`;
}

export function initYoung({ showMemo }) {
  showMemoFn = showMemo;
  $("young-ask").onclick = ask;
  $("young-q").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); });
  attachMic($("young-mic"), $("young-q"));
}
