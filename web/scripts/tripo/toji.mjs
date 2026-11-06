// 杜氏のキャラクターを Tripo の API で作る（このMacで一度だけ実行する。作品からは呼ばない）
// 使い方（web/ で）：
//   node --env-file=.env scripts/tripo/toji.mjs balance
//   node --env-file=.env scripts/tripo/toji.mjs generate   … 文章から3D（テクスチャ付き・ポリゴンを抑える）約30クレジット
//   node --env-file=.env scripts/tripo/toji.mjs rigcheck   … 骨を入れられるか確認（無料）
//   node --env-file=.env scripts/tripo/toji.mjs rig        … 骨入れ（人型・FBX）25クレジット
//   node --env-file=.env scripts/tripo/toji.mjs animate    … 「立って待つ」「うなずく」を付けた FBX を Unity に置く
// タスクの番号は scripts/tripo/.state.json に残す（コミットしない）。APIキーは web/.env の TRIPO_API_KEY だけから読む。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, ".state.json");
const OUT_PREVIEW = join(HERE, "out");
const OUT_UNITY = join(HERE, "../../../unity/KuraTwin/Assets/Toji");
const BASE = "https://openapi.tripo3d.ai/v3";
const KEY = process.env.TRIPO_API_KEY;
if (!KEY) { console.error("web/.env に TRIPO_API_KEY がありません"); process.exit(1); }

// 文章だけで作る（実在の人物の写真は使わない）。法被の文字は生成で崩れやすいので無地にする
const PROMPT = [
  "Full-body 3D character of an elderly Japanese sake brewery master (toji) in his 70s,",
  "standing upright in a relaxed A-pose, arms slightly away from the body, facing forward.",
  "He wears a plain white work cap, a white collared work shirt,",
  "and over it a plain navy blue happi coat with a white collar band and no text,",
  "dark work trousers and white rubber boots.",
  "Short grey hair, calm and kind expression, slightly weathered face.",
  "Realistic natural proportions, clean game-ready character model.",
].join(" ");
const NEGATIVE = "text, letters, kanji, logo, brand name, holding objects, tools, weapon, cartoon proportions, chibi, extra limbs";

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) throw new Error(`HTTP ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function wait(taskId) {
  for (;;) {
    const t = await api("GET", `/tasks/${taskId}`);
    process.stdout.write(`\r${t.type ?? ""} ${t.status} ${t.progress ?? 0}%   `);
    if (["success", "failed", "cancelled", "banned", "expired"].includes(t.status)) {
      console.log();
      if (t.status !== "success") throw new Error(`タスクが ${t.status} で終わりました: ${JSON.stringify(t)}`);
      return t;
    }
    await new Promise(r => setTimeout(r, 2500));
  }
}

// 出力のURLは5分で切れるので、すぐに保存する
async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロード失敗 ${res.status}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log("保存:", file);
}

const cmd = process.argv[2];
if (cmd === "balance") {
  console.log(await api("GET", "/account/balance"));
} else if (cmd === "generate") {
  const { task_id } = await api("POST", "/generation/text-to-model", {
    prompt: PROMPT, negative_prompt: NEGATIVE, model: "v3.1-20260211",
    texture: true, pbr: true, texture_quality: "standard",
    smart_low_poly: true, face_limit: 20000,
  });
  state.model = task_id; save();
  const t = await wait(task_id);
  await download(t.output.model_url, join(OUT_PREVIEW, "toji-model.glb"));
  if (t.output.rendered_image_url) await download(t.output.rendered_image_url, join(OUT_PREVIEW, "toji-preview.webp"));
} else if (cmd === "rigcheck") {
  const { task_id } = await api("POST", "/animations/rig-check", { input: state.model });
  const t = await wait(task_id);
  console.log(JSON.stringify(t.output));
} else if (cmd === "rig") {
  // v1.0 の骨：「立って待つ」「うなずく」の動きが使える（v3.0 の骨には無い）
  const { task_id } = await api("POST", "/animations/rig", { input: state.model, model: "v1.0-20240301", rig_type: "biped", out_format: "fbx" });
  state.rig = task_id; save();
  const t = await wait(task_id);
  await download(t.output.model_url, join(OUT_PREVIEW, "toji-rigged.fbx"));
} else if (cmd === "animate") {
  for (const [name, preset] of [["idle", "preset:biped:idle"], ["nod", "preset:biped:agree"]]) {
    const { task_id } = await api("POST", "/animations/retarget", { input: state.rig, animation: preset, out_format: "fbx", animate_in_place: true });
    state[`anim_${name}`] = task_id; save();
    const t = await wait(task_id);
    await download(t.output.model_url, join(OUT_UNITY, `Toji_${name}.fbx`));
  }
} else {
  console.log("balance | generate | rigcheck | rig | animate");
}
