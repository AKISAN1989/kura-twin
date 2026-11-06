// 杜氏への質問の決まり：選択肢を示さない・答えを想定しない・1文だけの開いた質問。
// Function（ask-toji）が Claude の出力を確かめるのと、テストの両方で使う。

// 選択肢や答えの想定を示す言い方
const CHOICE_PATTERNS = [
  [/それとも/, "「それとも」で選択肢を示している"],
  [/あるいは|もしくは|または/, "「あるいは／もしくは／または」で選択肢を示している"],
  [/(のでしょうか|ですか|ましたか|でしたか)[、,]/, "問いを2つ並べている"],
  [/(から|ため)(です|でした)か[？?]/, "理由を想定して聞いている"],
  [/のを見て(決め|判断し)(ました|た)か[？?]/, "見たものを想定して聞いている"],
  [/(いた|した|だった)(の|ん)(です|でしょう)か[？?]/, "した操作や様子を想定して聞いている"],
];

export const MAX_LEN = 45; // スマホ（文字19px・幅375px）で2〜3行

/** 決まりに合わない点を、日本語の文で返す（空なら合格） */
export function questionProblems(text, { maxLen = MAX_LEN } = {}) {
  const q = String(text ?? "").trim();
  const problems = [];
  if (!q) return ["質問が空"];
  const marks = (q.match(/[？?]/g) ?? []).length;
  if (marks !== 1) problems.push(`疑問符が${marks}個ある（1つだけにする）`);
  else if (!/[？?]$/.test(q)) problems.push("疑問符が文末にない");
  // スマホで2〜3行に収まる長さ。事実の前置きは短く（「。」は2つまで）、問いは文末の1つだけ
  if ([...q].length > maxLen) problems.push(`長すぎる（${[...q].length}字。${maxLen}字以内にする）`);
  if ((q.match(/。/g) ?? []).length > 2) problems.push("前置きが長い（短い事実と問い1つにする）");
  for (const [re, why] of CHOICE_PATTERNS) if (re.test(q)) problems.push(why);
  return problems;
}
