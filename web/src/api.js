// Netlify Functions（/api/...）を呼ぶ。APIキーはブラウザに置かない。
export async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("サーバーにつながりませんでした。通信を確認して再実行してください");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 返答が JSON でない（サーバーが起動していない等）
  }
  if (res.status === 429 && !data?.error) {
    throw new Error("短い時間に多く使われました。1分ほど待ってから再実行してください");
  }
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `サーバーから返答がありませんでした（${res.status}）。netlify dev で起動しているか確認してください`);
  }
  return data;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** エラー表示と再実行ボタン。入力内容は呼び出し側で消さない */
export function errorBox(container, message, retry) {
  container.innerHTML = `<div class="error">${esc(message)} <button type="button">再実行</button></div>`;
  container.querySelector("button").onclick = retry;
}
