// 右側の操作画面 → 左側の3D に送る5つの命令の共通窓口（SPEC 5章）。
// Unity版が読み込まれていれば SendMessage で KuraBridge オブジェクトへ送る。
// まだ無ければ console に出すだけ（Unityが無くても右側を作れるように）。

const TARGET = "KuraBridge";
let unity = null;
const listeners = { tankClicked: [] };

export function attachUnity(instance) {
  unity = instance;
}

function send(method, arg) {
  const payload = typeof arg === "string" ? arg : JSON.stringify(arg);
  if (unity) {
    unity.SendMessage(TARGET, method, payload);
  } else {
    console.info(`[bridge] ${method}`, arg);
  }
}

/**
 * setDay：全タンクの液面の高さと品温の色を、その日の状態にする。
 * state = { dayIndex, date, tempMin, tempMax, tanks: [{ id, level(0〜1), temp, joubou, stage }] }
 */
export function setDay(state) {
  send("SetDay", state);
}

/** highlightTank：変化があったタンクを赤く光らせる／消す */
export function highlightTank(tankId, on) {
  send("HighlightTank", { id: String(tankId), on: !!on });
}

/** setCamera：mode = "overview"（蔵全体） | "toji"（杜氏の目線：tankId の上から見下ろす） */
export function setCamera(mode, tankId = null) {
  send("SetCamera", { mode, id: tankId == null ? "" : String(tankId) });
}

/** selectTank：選んだタンクを強調する（null で解除） */
export function selectTank(tankId) {
  send("SelectTank", tankId == null ? "" : String(tankId));
}

/** tojiSay：杜氏のキャラクターの吹き出しに文章を出す（空文字で消す） */
export function tojiSay(text) {
  send("TojiSay", text ?? "");
}

/** 3D側でタンクがクリックされたとき（Unity の KuraBridge.jslib から呼ばれる） */
export function onTankClicked(fn) {
  listeners.tankClicked.push(fn);
}
window.kuraOnTankClicked = id => listeners.tankClicked.forEach(fn => fn(String(id)));
