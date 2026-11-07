// 共有の置き場所の名前：蔵コードのハッシュ（蔵コードそのものは保存しない）
import { createHash } from "node:crypto";
import { normalizeCode } from "../../shared/kura-code.mjs";

export const hash = text => createHash("sha256").update(`kura-twin:${text}`).digest("hex");
export const docKey = code => `kura/${hash(normalizeCode(code))}`;
