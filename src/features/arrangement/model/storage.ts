import type { Session } from "@/shared/types";
import { validateSession } from "../lib/validation";

/**
 * 沿用 v1 的存储键：保存写入 v2，读取时由校验器把旧版 v1
 * 自动迁移为 v2，用户不会因版本升级丢失作品。
 */
const KEY = "nightshift-session-v1";

export function saveSession(session: Session) {
  const safe = validateSession(session);
  localStorage.setItem(KEY, JSON.stringify(safe));
}

export function loadSession() {
  const text = localStorage.getItem(KEY);
  if (!text) throw new Error("还没有本地存档，请先保存");
  if (text.length > 2000000) throw new Error("存档过大，已保留当前作品");
  return validateSession(JSON.parse(text));
}
