import * as bridge from "./bridge.js";
import { store } from "./store.js";
import { app } from "./app.js";
import { esc } from "./api.js";
import { tankChart } from "./chart.js";
import { allTanksOn } from "./tank-state.js";
import { initToji } from "./panels/toji.js";
import { initYoung, askAbout, announceAnswers } from "./panels/young.js";
import { initSummary } from "./panels/summary.js";
import { initImport, resetImport } from "./panels/import.js";
import { DEMO_CODE, isValidCode, isDemoCode, formatCode, newCode } from "../shared/kura-code.mjs";

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
// ---------- 読み込み中の経過簿（墨の罫線と、1行ずつ書き込まれる数字） ----------
// 架空の醪の経過（日順1〜8日目）。読み込みの割合に合わせて、上の行から書き込んでいく
const LEDGER_HEAD = ["月日", "日順", "品温", "日本酒度", "状ぼう"];
const LEDGER_ROWS = [
  ["1/25", "1", "7.0", "−52", "筋泡"], ["1/26", "2", "8.2", "−40", "水泡"], ["1/27", "3", "9.5", "−30", "岩泡"],
  ["1/28", "4", "10.8", "−22", "高泡"], ["1/29", "5", "11.6", "−15", "高泡"], ["1/30", "6", "12.0", "−9", "落泡"],
  ["1/31", "7", "12.3", "−4", "玉泡"], ["2/1", "8", "12.1", "−1", "地"],
];
function buildLedger() {
  const svg = $("loader-ledger");
  if (!svg) return;
  const colW = [64, 48, 60, 80, 60], W = colW.reduce((a, b) => a + b, 0), headH = 26, rowH = 23, H = headH + rowH * LEDGER_ROWS.length;
  svg.setAttribute("viewBox", `-2 -2 ${W + 4} ${H + 4}`);
  const xs = colW.reduce((a, w) => [...a, a[a.length - 1] + w], [0]);
  const lines = [];
  // 罫線：外枠と見出しの下は少し太く。縦線、横線の順に引く
  lines.push(`<path class="rule thick" d="M0 0H${W}V${H}H0Z" style="--len:${2 * (W + H)};--d:0s"/>`);
  xs.slice(1, -1).forEach((x, i) => lines.push(`<path class="rule" d="M${x} 0V${H}" style="--len:${H};--d:${0.15 + i * 0.08}s"/>`));
  lines.push(`<path class="rule thick" d="M0 ${headH}H${W}" style="--len:${W};--d:.5s"/>`);
  LEDGER_ROWS.forEach((_, i) => lines.push(`<path class="rule faint" d="M0 ${headH + rowH * (i + 1)}H${W}" style="--len:${W};--d:${0.55 + i * 0.05}s"/>`));
  const cx = i => (xs[i] + xs[i + 1]) / 2;
  const head = LEDGER_HEAD.map((t, i) => `<text class="head" x="${cx(i)}" y="${headH - 8}">${t}</text>`).join("");
  const rows = LEDGER_ROWS.map((r, k) => `<g class="ledger-row" data-row="${k}">${r.map((t, i) =>
    `<text x="${cx(i)}" y="${headH + rowH * (k + 1) - 7}">${t}</text>`).join("")}</g>`).join("");
  svg.innerHTML = lines.join("") + head + rows;
}
// p：0〜1。進んだ分だけ行を書き込む（一度書いた行は消さない）
function writeLedger(p) {
  const rows = document.querySelectorAll("#loader-ledger .ledger-row");
  const n = Math.min(rows.length, Math.floor(p * (rows.length + 0.5)));
  rows.forEach((g, i) => { if (i < n) g.classList.add("on"); });
}

async function startUnity() {
  buildLedger();
  // ?loader=1：読み込み中の画面だけを、決まった速さで見せる（確認・動画の素材用）。3Dは読み込まない
  if (new URLSearchParams(location.search).has("loader")) {
    const t0 = performance.now(), dur = 6000;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      writeLedger(p);
      $("loader-text").textContent = p < 0.9 ? `蔵の戸を開けています… ${Math.round(p * 100)}%` : "蔵を組み立てています…";
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return;
  }

  const base = "unity/Build/kura";
  const status = $("unity-status");
  const setText = t => { $("loader-text").textContent = t; };
  const fail = t => { status.classList.add("failed"); setText(t); finishOpening(); };
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
      writeLedger(p);
      setText(p < 0.9 ? `蔵の戸を開けています… ${Math.round(p * 100)}%` : "蔵を組み立てています…");
    });
    // 3Dとつなぐのは、すぐに（Unity の「準備ができた」の知らせより前に）
    bridge.attachUnity(instance);
    guardCanvas($("unity-canvas"));
    // 読み込みが終わったら、残りの行を書き切ってから、ふわっと消す
    writeLedger(1);
    await new Promise(r => setTimeout(r, 450));
    status.classList.add("done");
    setTimeout(() => status.remove(), 700);
  } catch (e) {
    fail(`3Dを表示できませんでした：${e.message ?? e}`);
  }
}

// 杜氏の吹き出し：Unity が毎フレーム、頭の中心・口元（画面の割合、y は下から）と頭の半径を知らせてくる。
// 吹き出しは顔と頭を避けて、頭の横（空いている側）か頭の上に置き、しっぽを口元へ向ける。
// 上のカメラのボタン・日付の表示と画面の端にも重ならないようにする。長い答えは1文字ずつ送る
const bubble = { text: "", shown: 0, startedAt: 0 };
const TYPE_MS = 45; // 1文字の間
window.kuraOnTojiBubble = (text, x, y, visible, mx, my, r) => {
  const el = $("toji-bubble"), tail = $("toji-tail"), stage = el.parentElement;
  stage.classList.toggle("talking", !!(text && visible)); // 話しているあいだは操作のヒントを隠す
  if (!text || !visible) { el.hidden = true; tail.style.display = "none"; bubble.text = ""; return; }
  const short = [...text].length <= 8; // 見回りの品温（「11.0℃」）は小さな吹き出し
  if (bubble.text !== text) { bubble.text = text; bubble.startedAt = performance.now(); bubble.shown = short ? Infinity : 0; }
  el.hidden = false;
  el.classList.toggle("short", short);
  // 1文字ずつ送る（読み上げは全文を一度に）
  const chars = [...text];
  const n = short ? chars.length : Math.min(chars.length, Math.floor((performance.now() - bubble.startedAt) / TYPE_MS) + 1);
  const p = el.querySelector(".toji-text");
  if (p.dataset.n !== String(n) || p.dataset.full !== text) {
    p.dataset.n = n; p.dataset.full = text;
    p.innerHTML = "";
    p.append(document.createTextNode(chars.slice(0, n).join("")));
    if (n < chars.length) { const rest = document.createElement("span"); rest.className = "rest"; rest.textContent = chars.slice(n).join(""); p.append(rest); }
  }

  const W = stage.clientWidth, H = stage.clientHeight;
  // 上の余白：カメラのボタンと日付の表示（狭い画面ではボタンの下）
  const tools = stage.querySelector(".stage-tools"), badge = $("time-badge");
  const top = Math.max(tools ? tools.offsetTop + tools.offsetHeight + 8 : 56,
    badge && badge.textContent ? badge.offsetTop + badge.offsetHeight + 8 : 0);
  const pad = 10;
  p.style.maxHeight = `${Math.max(40, H - top - pad - 30)}px`;
  const bw = el.offsetWidth, bh = el.offsetHeight;

  // 頭（顔）の範囲：画面の座標（y は上から）
  const hx = x * W, hy = H - y * H, hr = Math.max(14, (r || 0.03) * H);
  const head = { l: hx - hr * 1.25, r: hx + hr * 1.25, t: hy - hr * 1.5, b: hy + hr * 1.15 };
  const gap = Math.max(18, hr * 0.7);
  const clampX = v => Math.max(pad, Math.min(W - bw - pad, v));
  const clampY = v => Math.max(top, Math.min(H - bh - pad, v));
  const overlaps = (L, T) => L < head.r && L + bw > head.l && T < head.b && T + bh > head.t;
  // 候補：空いている側の横 → 反対側の横 → 頭の上。顔に重ならない最初のものを使う
  const freeRight = W - head.r >= head.l;
  const sideY = clampY(hy - bh * 0.55);
  const sides = [
    [freeRight ? head.r + gap : head.l - gap - bw, sideY],
    [freeRight ? head.l - gap - bw : head.r + gap, sideY],
  ];
  const above = [hx - bw * 0.4, head.t - gap - bh];
  // 狭い画面（スマホ）は頭の上を先に試す
  const cands = (W < 600 ? [above, ...sides] : [...sides, above])
    .map(([L, T]) => ({ L: clampX(L), T: clampY(T), raw: [L, T] }));
  const overlapArea = c => Math.max(0, Math.min(c.L + bw, head.r) - Math.max(c.L, head.l)) * Math.max(0, Math.min(c.T + bh, head.b) - Math.max(c.T, head.t));
  const pick = cands.find(c => !overlaps(c.L, c.T) && Math.abs(c.L - c.raw[0]) < 2 && Math.abs(c.T - c.raw[1]) < 2) // 収まって、顔に重ならない
    ?? cands.find(c => !overlaps(c.L, c.T))
    ?? [...cands].sort((a, b) => overlapArea(a) - overlapArea(b))[0]; // どこも重なるときは、いちばん重なりの少ない所
  el.style.left = `${pick.L}px`;
  el.style.top = `${pick.T}px`;

  // しっぽ：吹き出しの縁から口元へ（顔に食い込まないよう、口元の少し手前で止める）
  const mX = (mx || x) * W, mY = H - (my || y) * H;
  const cx = pick.L + bw / 2, cy = pick.T + bh / 2;
  let dx = mX - cx, dy = mY - cy;
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  // 吹き出しの縁との交点。丸い角には付けず、まっすぐな辺の上に寄せる
  const tx = Math.abs(bw / 2 / (dx || 1e-6)), ty = Math.abs(bh / 2 / (dy || 1e-6));
  const rad = Math.min(20, bh / 2 - 1);
  let ex = cx + dx * Math.min(tx, ty), ey = cy + dy * Math.min(tx, ty);
  if (tx < ty) ey = Math.max(pick.T + rad, Math.min(pick.T + bh - rad, ey)); // 左右の辺
  else ex = Math.max(pick.L + rad, Math.min(pick.L + bw - rad, ex));         // 上下の辺
  // 縁の点から口元へ向け直す（しっぽは常に口元を指す）
  dx = mX - ex; dy = mY - ey;
  const toMouth = Math.hypot(dx, dy) || 1; dx /= toMouth; dy /= toMouth;
  // 先は口元の方向を向けたまま、頭の輪郭（少し外側）で止める。顔や帽子にかぶらないように
  const R = hr * 1.2, ox = ex - hx, oy = ey - hy;
  const bq = ox * dx + oy * dy, cq = ox * ox + oy * oy - R * R, disc = bq * bq - cq;
  let reach = toMouth - 6; // 頭に当たらなければ口元の少し手前まで
  if (cq > 0 && disc > 0) { const tHit = -bq - Math.sqrt(disc); if (tHit > 0) reach = Math.min(reach, tHit - 3); }
  const tipX = ex + dx * Math.max(0, reach), tipY = ey + dy * Math.max(0, reach);
  if (Math.hypot(tipX - ex, tipY - ey) < 8) { tail.style.display = "none"; return; } // 短すぎるしっぽは出さない
  const half = short ? 6 : 10, nx = -dy * half, ny = dx * half;
  const inX = ex - dx * 3, inY = ey - dy * 3; // 縁のすぐ内側から描いて、つなぎ目の線を消す
  tail.style.display = "";
  tail.setAttribute("viewBox", `0 0 ${W} ${H}`);
  tail.querySelector("polygon").setAttribute("points", `${inX + nx},${inY + ny} ${tipX},${tipY} ${inX - nx},${inY - ny}`);
  tail.querySelector("polyline").setAttribute("points", `${ex + nx},${ey + ny} ${tipX},${tipY} ${ex - nx},${ey - ny}`);
};
// ---------- 杜氏の見回り（Unity から：kai → temp → write → done） ----------
const PATROL_STEPS = [["kai", "櫂入れ"], ["temp", "品温を測る"], ["write", "経過簿に書く"]];
let patrolHideTimer = null;
window.kuraOnPatrol = (id, step, temp) => {
  const card = $("patrol-card");
  clearTimeout(patrolHideTimer);
  if (step === "done") { card.classList.add("fading"); patrolHideTimer = setTimeout(() => { card.hidden = true; card.classList.remove("fading"); }, 2500); return; }
  const tank = app.tank(id);
  const rec = tank?.records.filter(r => r.date <= app.date).pop();
  if (!rec) return;
  const idx = PATROL_STEPS.findIndex(([k]) => k === step);
  const written = step === "write";
  card.hidden = false;
  card.classList.remove("fading");
  card.innerHTML = `
    <div class="patrol-head"><span>杜氏の見回り</span><strong>${esc(app.tankLabel(id))}</strong></div>
    <ol class="patrol-steps">${PATROL_STEPS.map(([k, label], i) =>
      `<li class="${i < idx ? "done" : i === idx ? "now" : ""}">${esc(label)}</li>`).join("")}</ol>
    <table class="patrol-sheet" aria-label="この日の経過簿">
      <tr><th>月日</th><th>日順</th><th>品温</th><th>日本酒度</th><th>状ぼう</th></tr>
      <tr><td>${esc(rec.date.slice(5).replace("-", "/"))}</td><td>${rec.moromi_day ?? "-"}</td>
        <td class="${written ? "glow" : ""}">${written ? esc(temp || `${rec.temp}℃`) : "…"}</td>
        <td>${rec.nihonshudo ?? "-"}</td><td>${esc(rec.joubou ?? "-")}</td></tr>
    </table>`;
};

window.kuraOnUnityReady = () => {
  app.resend();
  app.emit("unity-ready");
  // 蔵コードを入れ直して読み直したときは、オープニングを1回だけ飛ばす
  if (sessionStorage.getItem("kura.skipOpening")) {
    sessionStorage.removeItem("kura.skipOpening");
    const done = (tries = 0) => { if ($("unity-status") && tries < 60) setTimeout(() => done(tries + 1), 100); else finishOpening(); };
    done();
    return;
  }
  // オープニング（大戸が開き、杜氏が「よう来たな」）：開くたびに再生する。
  // すぐに閉じた大戸の前へカメラを移して止めておき（ほかの視点が一瞬見えないように）、読み込み中の画面が消えてから動かす
  bridge.setCamera("opening", "hold");
  const go = (tries = 0) => {
    if ($("unity-status") && tries < 60) { setTimeout(() => go(tries + 1), 100); return; }
    bridge.setCamera("opening", "go");
    watchOpening();
  };
  go();
};

// ---------- 3Dの操作のボタン（寄る・引く・回る）と「歩いて見る」 ----------
// ボタンは押し続けると続けて動く。歩いて見るの切り替えは Unity からの知らせ（kuraOnCameraMode）で画面を合わせる
// （杜氏の案内が始まって自動で戻ったときも、画面がついてくる）
function initCamControls() {
  document.querySelectorAll("[data-cam]").forEach(b => {
    const [mode, arg] = b.dataset.cam.split(":");
    let timer = null;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
    b.addEventListener("pointerdown", e => {
      e.preventDefault();
      stop();
      bridge.setCamera(mode, arg);
      timer = setTimeout(() => { timer = setInterval(() => bridge.setCamera(mode, arg), 170); }, 420);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
    b.addEventListener("click", e => { if (e.detail === 0) bridge.setCamera(mode, arg); }); // キーボードで押したとき
  });
  $("walk-start").onclick = () => bridge.setCamera("walk");
  $("walk-back").onclick = () => bridge.setCamera("overview");
  if (!matchMedia("(pointer: coarse)").matches) $("walk-help").textContent = "矢印キー（WASD）で歩く・ドラッグで見回す";

  // スティック：倒した向きと量を、-1〜1 で送る（上が前）
  const stick = $("walk-stick"), knob = stick.querySelector(".stick-knob");
  let sent = "0,0", lastSend = 0, pid = null;
  const send = (x, y, force = false) => {
    const v = `${x.toFixed(2)},${y.toFixed(2)}`;
    const now = performance.now();
    if (v === sent || (!force && now - lastSend < 60)) return;
    sent = v; lastSend = now;
    bridge.setCamera("move", v);
  };
  const moveTo = e => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const len = Math.hypot(dx, dy), max = R - 10;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    send(dx / max, -dy / max);
  };
  stick.addEventListener("pointerdown", e => {
    e.preventDefault();
    pid = e.pointerId;
    try { stick.setPointerCapture(pid); } catch { /* 指が外へ出ても追えるように。できない環境ではそのまま */ }
    stick.classList.add("active");
    moveTo(e);
  });
  stick.addEventListener("pointermove", e => { if (e.pointerId === pid) moveTo(e); });
  const release = e => {
    if (e.pointerId !== pid) return;
    pid = null; stick.classList.remove("active"); knob.style.transform = "";
    send(0, 0, true);
  };
  stick.addEventListener("pointerup", release);
  stick.addEventListener("pointercancel", release);

  // キーボード：矢印キー・WASD で歩く（文字を打っているときは使わない）
  const keys = new Set();
  const KEY = { ArrowUp: "f", KeyW: "f", ArrowDown: "b", KeyS: "b", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" };
  const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const fromKeys = () => send((keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0), (keys.has("f") ? 1 : 0) - (keys.has("b") ? 1 : 0), true);
  window.addEventListener("keydown", e => {
    if (!document.body.classList.contains("walking") || typing(e.target) || !KEY[e.code]) return;
    e.preventDefault();
    keys.add(KEY[e.code]); fromKeys();
  });
  window.addEventListener("keyup", e => { if (KEY[e.code] && keys.delete(KEY[e.code])) fromKeys(); });
  window.addEventListener("blur", () => { if (keys.size) { keys.clear(); fromKeys(); } });

  window.kuraOnCameraMode = mode => {
    const walking = mode === "walk";
    document.body.classList.toggle("walking", walking);
    $("walk-ui").hidden = !walking;
    if (!walking) { keys.clear(); knob.style.transform = ""; sent = "0,0"; }
  };
}

// ---------- 記録の共有（蔵コード） ----------
function renderShareChip() {
  const chip = $("share-chip");
  const sy = store.sync;
  chip.classList.toggle("on", !!store.code && sy.status !== "offline");
  chip.classList.toggle("offline", !!store.code && sy.status === "offline");
  chip.textContent = !store.code ? "共有：この端末だけ"
    : sy.status === "offline" ? `共有：${store.code}（つながりません）`
    : `共有中：${isDemoCode(store.code) ? "デモ用" : store.code}`;
  chip.title = store.code ? "同じ蔵コードの端末どうしで記録を共有しています" : "蔵コードを入れると、同じ蔵の人と記録を共有できます";
}

function initShare() {
  const dlg = $("code-dialog"), input = $("code-input"), msg = $("code-msg");
  const say = (t, err = false) => { msg.textContent = t; msg.classList.toggle("err", err); };
  const open = () => {
    $("code-now").textContent = store.code
      ? `いまの蔵コード：${store.code}${isDemoCode(store.code) ? "（デモ用。1時間ごとに元のデモデータに戻ります）" : ""}`
      : "いまは、この端末の中だけで使っています。";
    $("code-leave").hidden = !store.code;
    input.value = store.code && !isDemoCode(store.code) ? store.code : "";
    say("");
    dlg.showModal();
  };
  // 蔵コードを変えたら、その蔵の記録で読み直す（オープニングは1回だけ飛ばす）
  const join = code => {
    store.setCode(code);
    sessionStorage.setItem("kura.skipOpening", "1");
    location.reload();
  };
  $("share-chip").onclick = open;
  $("pick-share").onclick = open;
  $("code-join").onclick = () => {
    if (!isValidCode(input.value)) { say("蔵コードは12文字です（例：AB23-CD45-EF67）。もう一度確かめてください。", true); input.focus(); return; }
    join(formatCode(input.value));
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") $("code-join").click(); });
  $("code-demo").onclick = () => join(DEMO_CODE);
  $("code-new").onclick = () => {
    input.value = newCode();
    say("新しい蔵コードを作りました。同じ蔵の人に伝えてから「この蔵コードで共有する」を押してください。");
  };
  $("code-leave").onclick = () => join(null);
  renderShareChip();
}

// ほかの端末の変更が届いたとき：3Dの液面・画面・質問の一覧を更新する。蔵人には、杜氏の答えが届いたら3Dの杜氏が知らせる
function onRemote(kind) {
  renderShareChip();
  if (kind !== "pull" || !app.season) return;
  app.applyDay();
  app.emit("synced");
  if (app.role === "kurabito" && openingDone) announceAnswers();
}

// ---------- オープニングの終わり（7.5秒、または画面に触って飛ばしたとき） ----------
const OPENING_MS = 7700;
let openingDone = false;
const afterOpening = [];
function whenOpeningDone(fn) { if (openingDone) fn(); else afterOpening.push(fn); }
function finishOpening() {
  if (openingDone) return;
  openingDone = true;
  app.emit("opening-done");
  afterOpening.splice(0).forEach(fn => fn());
}
function watchOpening() {
  const timer = setTimeout(finishOpening, OPENING_MS);
  // Unity と同じく、クリック・タップ・スクロール・キーで飛ばす（3Dが蔵全体の視点に戻るのを少し待つ）
  const skip = () => { clearTimeout(timer); off(); setTimeout(finishOpening, 300); };
  const canvas = $("unity-canvas");
  const off = () => {
    canvas.removeEventListener("pointerdown", skip); canvas.removeEventListener("wheel", skip); window.removeEventListener("keydown", skip);
  };
  canvas.addEventListener("pointerdown", skip); canvas.addEventListener("wheel", skip, { passive: true }); window.addEventListener("keydown", skip);
}

// ---------- 役割（蔵人／杜氏） ----------
// 杜氏：今日の質問だけ（判断を語る）。蔵人：今日やること → 蔵の様子（暦と見取り図） → 杜氏に聞く
function setRole(role, { remember = true } = {}) {
  if (remember) store.setRole(role);
  app.role = role;
  app.tab = role === "toji" ? "toji" : "young";
  const toji = role === "toji";
  document.body.classList.toggle("toji-mode", toji);
  document.body.classList.toggle("kurabito-mode", !toji);
  document.querySelectorAll("[data-role]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.role === role)));
  $("tab-toji").hidden = !toji;
  $("tab-young").hidden = toji;
  $("today-card").hidden = toji || importOpen;
  $("tab-import").hidden = toji || !importOpen;
  if (toji) {
    app.selectTank(null);
    // 杜氏は今日の質問に答える：過去の記録を見ていたら、今季の今日へ戻す
    if (!app.isCurrent || app.date !== app.seasonData.today) app.setSeason(store.currentSeason);
  }
  app.emit("tab");
  app.emit("role");
  // 蔵人として開いたとき：杜氏が答えた問いがあれば、オープニングの後で3Dの杜氏が知らせる
  // （オープニングの「よう来たな」のすぐ後に重ならないよう、少し間をおく）
  if (!toji) whenOpeningDone(() => setTimeout(() => { if (app.role === "kurabito") announceAnswers(); }, 1200));
}

function showRolePicker() {
  const pick = $("role-pick");
  pick.hidden = false;
  requestAnimationFrame(() => pick.classList.add("on"));
  pick.querySelector(`[data-pick="${store.role ?? "kurabito"}"]`)?.focus({ preventScroll: true });
  pick.querySelectorAll("[data-pick]").forEach(b => {
    b.onclick = () => {
      pick.classList.remove("on");
      setTimeout(() => { pick.hidden = true; }, 350);
      setRole(b.dataset.pick);
    };
  });
}

// ---------- 蔵人：今日やること ----------
let importOpen = false;
function openImport(open) {
  importOpen = open;
  if (open) app.backToToday(); // 今季の経過簿を取り込むので、過去を見ていたら今季の今日へ戻す
  if (!open) resetImport();
  if (app.role === "kurabito") {
    $("today-card").hidden = open;
    $("tab-import").hidden = !open;
  }
  if (open) $("tab-import").scrollIntoView({ block: "nearest", behavior: "smooth" });
  else renderToday();
}

function renderToday() {
  const box = $("today-card");
  const today = store.seasons[store.currentSeason].today;
  const log = store.todayLog;
  const done = log && log.date === today;
  const events = detectToday();
  const waiting = store.asks.filter(a => store.answerOf(a.id)).length;
  box.innerHTML = `
    <div class="today-head"><h2 class="sec-head" id="today-title">今日やること</h2><span class="today-date">${md(today)}</span></div>
    ${done
      ? `<div class="today-done" role="status"><span class="check" aria-hidden="true">✓</span>
          <div><strong>今日の経過簿：記録済み</strong><span class="muted small">${esc(app.tankLabel(log.tank))}・${log.days}日分（${new Date(log.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}）</span></div>
          <label for="import-file" class="link small again" data-open-import>もう1枚撮る</label></div>`
      : `<label for="import-file" class="btn-shoot" data-open-import>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
          <span class="shoot-main">今日の経過簿を撮る</span><span class="shoot-sub">写真・Excel・PDF。Claude が読み取ります</span></label>`}
    ${events.length ? `<div class="today-events"><span class="muted small">今日、変化のあったタンク</span>
      ${events.map(id => `<button type="button" class="chip" data-tank="${esc(id)}"><i class="mk ev"></i>${esc(app.tankLabel(id))}</button>`).join("")}</div>` : ""}
    ${waiting ? `<button type="button" class="today-answers link" data-goto-young>杜氏からの答えを見る（${waiting}件）</button>` : ""}`;
  box.querySelectorAll("[data-open-import]").forEach(l => l.addEventListener("click", () => openImport(true)));
  box.querySelectorAll("[data-tank]").forEach(b => {
    b.onclick = () => {
      if (!app.isCurrent || app.date !== today) app.setSeason(store.currentSeason, today);
      app.selectTank(b.dataset.tank);
      $("tank-detail").scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  });
  box.querySelector("[data-goto-young]")?.addEventListener("click", () => $("tab-young").scrollIntoView({ block: "start", behavior: "smooth" }));
}
// 今日（今季の暦の今日）に変化のあったタンク
function detectToday() {
  const today = store.seasons[store.currentSeason].today;
  if (!app.isCurrent) return [];
  return [...new Set(app.eventsOn(today).map(e => e.tank))];
}

// ---------- 今と過去の表示（3Dの上） ----------
// 表示している日付と「今季／過去の仕込み」。過去へ移るときは、日付がさかのぼるように数字を動かす
let badgeShown = null; // { date, past }
let badgeTimer = null;
const md = d => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
function badgeText(date, past) {
  const y = date.slice(0, 4);
  if (!app.isCurrent) return `過去の仕込み（${app.season}年）　${y}年${md(date)}の記録`;
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
  renderStrip();
  const d = app.date;
  $("day-label").textContent = `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日${app.isCurrent && d === app.seasonData.today ? "（今日）" : ""}`;
  document.body.classList.toggle("past", app.isPast); // 今季は暖かい色、過去は青みのある色（左の3Dと揃える）
  renderTankButtons();
  renderTankDetail();
}

// 暦の帯：1日1枡。変化のあった日と判断メモのある日の印は、季と判断メモの数が変わったときだけ数え直す
let stripKey = "", stripMarks = null;
function renderStrip() {
  const strip = $("day-strip");
  const memoDates = new Set(store.allMemos().filter(m => m.season === app.season).map(m => m.date));
  const key = `${app.season}|${app.calendar.length}|${memoDates.size}`;
  if (key !== stripKey) {
    stripKey = key;
    stripMarks = app.calendar.map(d => ({ ev: app.eventsOn(d).length > 0, memo: memoDates.has(d) }));
    const today = app.isCurrent ? app.seasonData.today : null;
    strip.innerHTML = app.calendar.map((d, i) => {
      const day = Number(d.slice(8, 10)), m = Number(d.slice(5, 7));
      const first = i === 0 || day === 1;
      const mk = stripMarks[i];
      const label = `${m}月${day}日${mk.ev ? "・変化あり" : ""}${mk.memo ? "・判断メモあり" : ""}`;
      return `<button type="button" role="option" tabindex="-1" data-i="${i}" class="cal-day${first ? " month" : ""}${d === today ? " today" : ""}" aria-label="${label}">
        ${first ? `<span class="cal-m">${m}月</span>` : ""}<span class="cal-d">${day}</span>
        <span class="cal-mk">${mk.ev ? '<i class="mk ev"></i>' : ""}${mk.memo ? '<i class="mk memo"></i>' : ""}</span></button>`;
    }).join("");
  }
  strip.querySelectorAll(".cal-day.on").forEach(b => { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
  const cur = strip.querySelector(`[data-i="${app.dayIndex}"]`);
  if (cur) {
    cur.classList.add("on"); cur.setAttribute("aria-selected", "true");
    const smooth = stripKey === strip.dataset.shown;
    strip.dataset.shown = stripKey;
    requestAnimationFrame(() => centerStrip(smooth));
  }
}

// 選んだ日が帯の中ほどに来るように（ページ全体は動かさない）。杜氏のタブでは帯が隠れているので、タブを移ったときにも呼ぶ
function centerStrip(smooth = false) {
  const strip = $("day-strip"), cur = strip.querySelector(".cal-day.on");
  if (!cur || !strip.clientWidth) return;
  const s = strip.getBoundingClientRect(), c = cur.getBoundingClientRect();
  const want = strip.scrollLeft + (c.left - s.left) - s.width / 2 + c.width / 2;
  strip.scrollTo({ left: Math.max(0, want), behavior: smooth ? "smooth" : "auto" });
}

// タンクの見取り図：奥（6〜10号）と手前（1〜5号）の間に足場。緑の琺瑯タンクを上から見た絵
function renderTankButtons() {
  const events = new Set(app.eventsOn().map(e => e.tank));
  const states = new Map(allTanksOn(app.seasonData, app.date, store.kura.tank_capacity_l ?? 3000).map(s => [s.id, s]));
  const tankBtn = t => {
    const st = states.get(t.id);
    const empty = !st || st.level <= 0.001;
    const cls = ["tk", app.selected === t.id ? "on" : "", events.has(t.id) ? "alert" : "", empty ? "empty" : ""].join(" ");
    const label = `${t.label}${events.has(t.id) ? "・変化あり" : ""}${empty ? "・空（覆い）" : ""}`;
    return `<button type="button" data-id="${t.id}" class="${cls}" aria-label="${esc(label)}" aria-pressed="${app.selected === t.id}">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tk-rim" cx="20" cy="20" r="17"/><circle class="tk-in" cx="20" cy="20" r="12.5"/></svg>
      <span class="tk-n">${esc(t.id)}</span></button>`;
  };
  const back = store.kura.tanks.filter(t => t.row === 1).sort((a, b) => a.x - b.x);
  const front = store.kura.tanks.filter(t => t.row !== 1).sort((a, b) => a.x - b.x);
  $("tank-buttons").innerHTML = `<div class="tk-row">${back.map(tankBtn).join("")}</div>
    <div class="tk-deck" aria-hidden="true"></div>
    <div class="tk-row">${front.map(tankBtn).join("")}</div>`;
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
    ${askRow(id)}
    ${tankChart(recs, { memoDays: memos.map(m => m.moromi_day), eventDays })}
    <div class="memos">
      ${memos.length ? memos.map(m => `<button type="button" class="memo-link" data-memo="${esc(m.id)}">
          <span class="muted">${esc(m.date.slice(5).replace("-", "/"))} 日順${m.moromi_day}</span> ${esc(m.change)}</button>`).join("")
        : `<p class="muted small">このタンクの判断メモはまだありません。</p>`}
    </div>`;
  $("detail-close").onclick = () => { app.selectTank(null); bridge.setCamera("overview"); };
  box.querySelector("[data-ask-toji]")?.addEventListener("click", () => {
    const ev = tankEvent(id);
    if (ev) askAbout(ev);
  });
  box.querySelectorAll("[data-memo]").forEach(b => {
    b.onclick = () => showMemo(store.allMemos().find(m => m.id === b.dataset.memo));
  });
}

// 選んだタンクの変化：その日の変化、無ければその日までのいちばん新しい変化（蔵人のときだけ使う）
function tankEvent(id) {
  return app.eventsOn().find(e => e.tank === id) ?? app.eventsUpTo().filter(e => e.tank === id).pop() ?? null;
}
function askRow(id) {
  if (app.role !== "kurabito") return "";
  const ev = tankEvent(id);
  if (!ev) return "";
  const when = ev.date === app.date ? "この日" : `${md(ev.date)}`;
  return `<div class="ask-toji-row"><p class="ev-line"><i class="mk ev"></i>${esc(when)}${ev.moromi_day >= 1 ? `（留添${ev.moromi_day}日目）` : ""}：${esc(ev.change)}</p>
    <button type="button" class="btn-ask-toji" data-ask-toji><svg class="fig" aria-hidden="true"><use href="#fig-toji"/></svg>このとき杜氏はどうしてた？</button></div>`;
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
    <h3>${esc(memo.season)}年 ${esc(memo.tank ? app.tankLabel(memo.tank) : "蔵人の問い")} ${esc(memo.date)}${memo.moromi_day != null ? `（日順${memo.moromi_day}）` : ""}</h3>
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

async function main() {
  store.onRemote = onRemote;
  await store.load();
  // 季：今季と、毎年積み重なる過去の仕込み
  $("season-select").innerHTML = Object.keys(store.seasons).sort().reverse()
    .map(s => `<option value="${s}">${s === store.currentSeason ? `今季（${s}年 仕込み）` : `過去の仕込み（${s}年）`}</option>`).join("");
  $("season-select").onchange = e => app.setSeason(e.target.value);
  $("day-strip").addEventListener("click", e => {
    const b = e.target.closest("[data-i]");
    if (b) app.setDayIndex(Number(b.dataset.i));
  });
  $("day-strip").addEventListener("keydown", e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -1e4, End: 1e4 }[e.key];
    if (step == null) return;
    e.preventDefault();
    app.setDayIndex(app.dayIndex + step);
  });
  $("tank-buttons").addEventListener("click", e => {
    const id = e.target.closest("button")?.dataset.id;
    if (id) app.selectTank(app.selected === id ? null : id);
  });
  bridge.onTankClicked(id => app.selectTank(id));
  $("cam-overview").onclick = () => bridge.setCamera("overview");
  initCamControls();
  initShare();
  $("cam-toji").onclick = () => bridge.setCamera("toji", app.selected ?? store.kura.tanks[0].id);
  $("reset-local").onclick = () => {
    if (confirm("この端末に保存した取り込み結果・判断メモ・質問を消します。よろしいですか？")) {
      store.resetLocal();
      location.reload();
    }
  };

  app.onChange(kind => {
    if (kind === "season") $("season-select").value = app.season;
    if (kind !== "tab") renderDay(); // 判断メモを残したときも、暦の印を数え直す
    if (kind === "tab") requestAnimationFrame(() => centerStrip());
    if (kind !== "tab") renderTimeBadge();
  });
  initToji({ showMemo });
  initYoung({ showMemo });
  initSummary({ showMemo });
  initImport();
  $("import-back").onclick = () => openImport(false);
  document.querySelectorAll("[data-role]").forEach(b => { b.onclick = () => { if (app.role !== b.dataset.role) setRole(b.dataset.role); }; });
  app.onChange(kind => {
    if (kind === "imported") openImport(false);
    if (["season", "day", "memo-saved", "ask-sent", "role", "opening-done", "synced"].includes(kind)) renderToday();
  });

  app.setSeason(store.currentSeason);
  // 役割：覚えていればそのまま入る。初めて（または ?pick=1）は、オープニングの後に選ぶ画面を出す
  const forcePick = new URLSearchParams(location.search).has("pick");
  setRole(store.role && !forcePick ? store.role : "kurabito", { remember: false });
  if (!store.role || forcePick) whenOpeningDone(showRolePicker);
  startUnity();
}

main().catch(e => {
  if ($("loader-text")) $("loader-text").textContent = e.message;
  console.error(e);
});
