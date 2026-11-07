// Excel の経過簿：ブラウザで表（セルの文字）に直したものから、見出しの位置と、どの項目にあたるかを推定する。
// 値は Claude に書き写させず、ブラウザが元のセルからそのまま取る（Excel の数値を正確に使うため）。
import { z } from "zod";
import { askJson, handler, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";
import { FIELD_MEANINGS, FieldKey } from "../lib/sheet-fields.mjs";

const Result = z.object({
  tank: z.string().nullable().describe("表全体のタンク番号（題や欄外にあれば数字だけ）。表の中にタンクの列・行があれば null"),
  layout: z.enum(["dates_across", "dates_down"]).describe("日付が横に並ぶ（見出しが1つの列に縦に並ぶ）なら dates_across、日付が縦に並ぶ（見出しが1つの行に横に並ぶ）なら dates_down"),
  header: z.number().int().describe("見出しが並ぶ行の番号（dates_down）または列の番号（dates_across）。0から"),
  labels: z.array(z.object({
    pos: z.number().int().describe("見出しのセルの位置：dates_down なら列の番号、dates_across なら行の番号（0から）"),
    text: z.string().describe("見出しのセルの文字そのまま"),
    field: FieldKey,
    confidence: z.enum(["high", "low"]).describe("対応に迷いがなければ high。略語・別の意味もありうる名前・値の様子と合わないときは low"),
    reason: z.string().describe("そう判断した理由（短く。値の様子も含めて）"),
  })).describe("表の見出し（項目名）。並んでいる順に、すべて"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：Excel の醪経過表（経過簿）の、見出しの位置と意味を推定する
- 渡されるのは、表のセルの文字（行ごとに「r行: c列=文字」の形）。
- 蔵ごとに書式が違う。日付が横に並ぶ表も、縦に並ぶ表もある。見出しの名前・順番も違い、無い項目もある。1枚に複数のタンクが書かれていることもある。
- 見出し（項目名）のセルを、並んだ順にすべて拾い、蔵ツインのどの項目にあたるかを選ぶ。
${FIELD_MEANINGS}
- 対応に少しでも迷うとき（略語、蔵によって意味の違う名前、値の様子が項目と合わない）は confidence を low にする。決めつけない。
- 値は書き写さない（見出しの位置と意味だけを答える）。`;

export default handler(async ({ grid }) => {
  if (!Array.isArray(grid) || !grid.length) throw new HttpError(400, "表が空です");
  const text = grid.map((row, r) => `${r}行: ${row.map((v, c) => (v === "" || v == null ? null : `${c}列=${v}`)).filter(Boolean).join(" ／ ")}`)
    .filter(line => !/行: $/.test(line)).join("\n");
  return askJson({
    model: MODELS.precise,
    system: SYSTEM,
    effort: "medium",
    content: `# 表のセル\n${text}`,
    schema: Result,
  });
});

export const config = { path: "/api/read-grid" };
