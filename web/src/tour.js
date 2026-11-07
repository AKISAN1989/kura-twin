// 杜氏の案内ツアー：初めて見る人（審査員など）が、説明なしで使い方が分かるように、3Dの杜氏が3つの場面を案内する。
// ・決められた台詞と画面の動きだけで作る（Claude は呼ばない）
// ・初めて開いたときだけ、オープニングの後に自動で始める。右の画面の「案内を見る」でいつでも見直せる
// ・画面に触るか「飛ばす」で、いつでも終われる。全体で1分以内
import * as bridge from "./bridge.js";

const SEEN_KEY = "kura.tour.v1";
const MAX_MS = 55000;   // 全体の上限
const HOLD_MS = 7600;   // 吹き出しが出てから次へ進むまで（読む時間）
const WAIT_MS = 12000;  // 杜氏が歩いてから話す場面で、吹き出しを待つ上限

// 3つの場面：杜氏の台詞、カメラ（tank があれば杜氏がそのタンクへ歩いて、顔に寄って話す）、右の画面で示す所
const STEPS = [
  { say: "わしの蔵へようこそ。毎朝、蔵人が経過簿を撮ると、この蔵のタンクに反映される",
    camera: "overview", spot: "#today-card .btn-shoot, #today-card", label: "蔵人：今日の経過簿を撮る" },
  { say: "品温を下げた日などは、Claudeがわしに理由を聞きに来る。わしは声で一言答えるだけじゃ",
    tank: "7", spot: '.role-switch [data-role="toji"]', label: "杜氏：判断を語る（今日の質問に声で答える）" },
  { say: "お前さんが迷ったら聞いてみい。記録をたどって、わしの判断を理由ごと教えてやる",
    spot: "#tab-young", label: "蔵人：杜氏に聞く" },
];

let active = false;
export const isTourActive = () => active;
export function tourSeen() { try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* 保存できない設定でも、案内は見られる */ } }

/**
 * 案内を始める。
 * onEnd：終わったとき（最後まで見た・飛ばした・触った）に呼ぶ（役割を選ぶ画面へ進む）
 * prepare：始める前に画面を蔵人の今日の画面にそろえる（案内の場面は蔵人の画面で示すため）
 */
export function startTour({ onEnd, prepare }) {
  if (active) return;
  active = true;
  markSeen();
  prepare?.();
  let ended = false, stepTimer = null;
  const bar = buildBar();
  const spotOff = () => document.querySelectorAll(".tour-spot").forEach(el => el.classList.remove("tour-spot"));

  // 杜氏の吹き出しが出たことを知る（main.js の吹き出しの処理を包む。終わったら元に戻す）
  const origBubble = window.kuraOnTojiBubble;
  let bubbleWaiter = null;
  window.kuraOnTojiBubble = (text, ...rest) => {
    origBubble?.(text, ...rest);
    if (text && rest[2] && bubbleWaiter && text === bubbleWaiter.text) { const w = bubbleWaiter; bubbleWaiter = null; w.done(); }
  };
  const waitBubble = (text, ms) => new Promise(done => {
    bubbleWaiter = { text, done };
    stepTimer = setTimeout(() => { bubbleWaiter = null; done(); }, ms);
  });

  const end = () => {
    if (ended) return;
    ended = true;
    active = false;
    clearTimeout(stepTimer); clearTimeout(cap);
    document.removeEventListener("pointerdown", onTouch, true);
    document.removeEventListener("keydown", onKey, true);
    window.kuraOnTojiBubble = origBubble;
    spotOff();
    bar.classList.remove("on");
    setTimeout(() => bar.remove(), 400);
    bridge.tojiSay("");
    bridge.setCamera("overview");
    document.body.classList.remove("touring");
    if (matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector(".panel")?.scrollTo({ top: 0, behavior: "smooth" }); // 右の画面も先頭へ戻す
    onEnd?.();
  };
  // 画面のどこかに触る・キーを押すと終わる（始めたボタンの押下で終わらないよう、次の操作から）
  const onTouch = e => { if (!bar.contains(e.target)) end(); };
  const onKey = e => { if (e.key !== "Tab") end(); };
  setTimeout(() => {
    if (ended) return;
    document.addEventListener("pointerdown", onTouch, true);
    document.addEventListener("keydown", onKey, true);
  }, 250);
  bar.querySelector("[data-skip]").onclick = end;
  const cap = setTimeout(end, MAX_MS);
  document.body.classList.add("touring");

  (async () => {
    for (let i = 0; i < STEPS.length && !ended; i++) {
      const s = STEPS[i];
      spotOff();
      // 示す所：書いた順に探し、見えている最初のものを光らせる
      const el = s.spot.split(",").map(q => [...document.querySelectorAll(q.trim())].find(x => x.offsetParent)).find(Boolean);
      bar.querySelector("[data-step]").textContent = `案内 ${i + 1}/${STEPS.length}`;
      bar.querySelector("[data-label]").textContent = s.label;
      bar.querySelector("[data-say]").textContent = `「${s.say}」`;
      bar.classList.add("on");
      if (el) {
        el.classList.add("tour-spot");
        showSpot(el, bar); // 帯に台詞を入れてから（帯の高さが決まってから）位置を合わせる
      }
      if (s.camera) bridge.setCamera(s.camera);
      bridge.tojiSay(s.say, s.tank ?? null);
      await waitBubble(s.say, s.tank ? WAIT_MS : 1800);
      if (ended) return;
      await new Promise(r => { stepTimer = setTimeout(r, HOLD_MS); });
    }
    end();
  })();
}

// 示す所を見える位置へ。スマホ（3Dが上・操作画面が下）では、下の帯のすぐ上に見える分だけ動かし、3Dの杜氏をなるべく画面に残す
function showSpot(el, bar) {
  if (!matchMedia("(max-width: 860px)").matches) { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
  const r = el.getBoundingClientRect(), barH = (bar.getBoundingClientRect().height || 120) + 24;
  const visibleBottom = innerHeight - barH;
  if (r.top >= 8 && r.bottom <= visibleBottom) return;
  const dy = r.bottom > visibleBottom ? Math.min(r.top - 12, r.bottom - visibleBottom) : r.top - 12;
  window.scrollBy({ top: dy, behavior: "smooth" });
}

// 画面の下の帯：何番目の案内か、どこを示しているか、台詞（スマホでは3Dが見えないことがあるので）、「飛ばす」
function buildBar() {
  const bar = document.createElement("div");
  bar.className = "tour-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<div class="tour-text"><span class="tour-step" data-step></span><span class="tour-label" data-label></span>
    <p class="tour-say" data-say></p></div><button type="button" class="tour-skip" data-skip>飛ばす</button>`;
  document.body.appendChild(bar);
  return bar;
}
