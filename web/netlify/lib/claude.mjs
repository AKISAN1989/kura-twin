// Netlify Functions 共通：Claude API の呼び出し（APIキーはサーバー側の環境変数 ANTHROPIC_API_KEY だけで使う）
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TERMS } from "../../shared/terms.mjs";

export const MODELS = {
  precise: "claude-opus-5-5", // 手書きの読み取り・読み直し・回答・照合
  light: "claude-haiku-5-5", // 杜氏への質問・タンクの要約
};

// 作品の中のClaudeに共通の約束（CLAUDE.md の設計の原則と同じ）
export const PRINCIPLES = `あなたは酒蔵の記録係です。役割は「記録を読む」「杜氏に聞く」「記録から答える」の3つだけです。
- 醸造の判断・評価・助言（「こうすべき」「遅れている」「良い／悪い」）は一切しません。最終判断は常に杜氏です。
- 記録にないことは書きません。読めない・分からないものは推測で埋めません。
- 用語は次の定義に従います。

${TERMS}`;

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(500, "サーバーに APIキー（ANTHROPIC_API_KEY）が設定されていません");
  }
  client ??= new Anthropic();
  return client;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * 構造化出力で JSON を受け取る。
 * content はユーザーメッセージの中身（文字列か、画像とテキストのブロック配列）
 */
export async function askJson({ model, system, content, schema, effort = "medium", maxTokens = 16000 }) {
  const response = await getClient().messages.parse({
    model,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: zodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new HttpError(502, "Claude がこの依頼に答えられませんでした。内容を変えてもう一度試してください");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new HttpError(502, "Claude の返答が途中で切れました。もう一度試してください");
  }
  return response.parsed_output;
}

/** Function の入口：JSON を受け取り、エラーは日本語のメッセージで返す */
export function handler(fn) {
  return async req => {
    if (req.method !== "POST") return json({ error: "POST で送ってください" }, 405);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "送られた内容を読めませんでした" }, 400);
    }
    try {
      return json(await fn(body));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude API が混み合っています。少し待ってから再実行してください" }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "APIキーが正しくありません（サーバーの設定を確認してください）" }, 500);
      if (e instanceof Anthropic.BadRequestError) return json({ error: `Claude API への依頼の形が正しくありません：${e.message}` }, 400);
      if (e instanceof Anthropic.APIError) return json({ error: `Claude API のエラー（${e.status ?? "接続"}）。再実行してください` }, 502);
      console.error(e);
      return json({ error: "サーバーでエラーが起きました。再実行してください" }, 500);
    }
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function imageBlock(dataUrlOrBase64, mediaType) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrlOrBase64);
  const media_type = m ? m[1] : mediaType;
  const data = m ? m[2] : dataUrlOrBase64;
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(media_type)) {
    throw new HttpError(400, "画像は JPEG・PNG・WebP で送ってください");
  }
  return { type: "image", source: { type: "base64", media_type, data } };
}
