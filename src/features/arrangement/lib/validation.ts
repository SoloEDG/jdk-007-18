import type {
  Session,
  LegacySession,
  Track,
  Note,
  Group,
  Channel,
} from "@/shared/types";

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const channel = (x: unknown): Channel | null =>
  object(x) && finite(x.volume, 0, 1) && typeof x.muted === "boolean"
    ? { volume: x.volume, muted: x.muted }
    : null;

const validateCore = (raw: Record<string, unknown>, beats: number, version: number) => {
  if (
    typeof raw.title !== "string" ||
    raw.title.length > 80 ||
    !finite(raw.bpm, 40, 220) ||
    ![4, 8, 16, 32].includes(beats) ||
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > 8 ||
    !object(raw.channels) ||
    !finite(raw.master, 0, 1) ||
    (version !== 1 && version !== 2)
  )
    throw new Error("存档格式或版本不受支持");
};

const validateTracks = (
  rawTracks: unknown[],
  beats: number,
  rawChannels: Record<string, unknown>,
): { tracks: Track[]; channels: Record<string, Channel> } => {
  const ids = new Set<string>();
  const noteIds = new Set<string>();
  const tracks: Track[] = [];
  const channels: Record<string, Channel> = {};
  for (const value of rawTracks) {
    if (!object(value)) throw new Error("轨道损坏");
    const t = value as unknown as Track;
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !t.id ||
      typeof t.name !== "string" ||
      t.name.length > 32 ||
      !["drums", "keys"].includes(t.instrument) ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !Array.isArray(t.notes) ||
      t.notes.length > 2048
    )
      throw new Error("轨道数据无效");
    ids.add(t.id);
    for (const n of t.notes as Note[]) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        noteIds.has(n.id) ||
        !finite(
          n.pitch,
          t.instrument === "drums" ? 0 : 24,
          t.instrument === "drums" ? 3 : 108,
        ) ||
        !Number.isInteger(n.pitch) ||
        !finite(n.beat, 0, beats - 0.000001) ||
        !finite(n.duration, 0.01, beats) ||
        !finite(n.velocity, 0.01, 1)
      )
        throw new Error("音符数据无效");
      noteIds.add(n.id);
    }
    const mix = channel(rawChannels[t.id]);
    if (!mix) throw new Error("混音数据无效");
    channels[t.id] = mix;
    tracks.push(structuredClone(t));
  }
  return { tracks, channels };
};

/** v1 存档迁移：全部轨道挂根层级，编组为空 */
const fromV1 = (raw: LegacySession): Session => ({
  version: 2,
  title: raw.title,
  bpm: raw.bpm,
  beats: raw.beats,
  tracks: structuredClone(raw.tracks),
  groups: [],
  trackGroups: Object.fromEntries(raw.tracks.map((t) => [t.id, null])),
  channels: structuredClone(raw.channels),
  groupsMix: {},
  master: raw.master,
});

export type ValidatedSession = Session & { warnings?: string[] };

/**
 * 校验并归一化存档。返回值永远是结构完整的 v2：
 * - 旧版 v1 自动迁移
 * - 父编组缺失/成环时，把受影响节点安全提升到根层级，并通过 warnings 提示
 * - 任何致命错误都抛异常，调用方据此保留当前作品，不做半套覆盖
 */
export function validateSession(raw: unknown): ValidatedSession {
  if (!object(raw)) throw new Error("存档格式或版本不受支持");
  const legacy = raw as unknown as LegacySession;
  if (legacy.version === 1) return validateSession(fromV1(legacy));
  if (legacy.version !== 2) throw new Error("存档格式或版本不受支持");

  const beats = raw.beats as number;
  validateCore(raw, beats, 2);
  const { tracks, channels } = validateTracks(
    raw.tracks as unknown[],
    beats,
    raw.channels as Record<string, unknown>,
  );
  const warnings: string[] = [];

  // 编组校验：去重、名称长度、父引用存在性
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  if (rawGroups.length > 16) throw new Error("编组数量超出限制");
  const groups: Group[] = [];
  const groupIds = new Set<string>();
  for (const value of rawGroups) {
    if (!object(value)) throw new Error("编组数据无效");
    const g = value as unknown as Group;
    if (
      typeof g.id !== "string" ||
      !g.id ||
      groupIds.has(g.id) ||
      typeof g.name !== "string" ||
      !g.name ||
      g.name.length > 32
    )
      throw new Error("编组数据无效");
    groupIds.add(g.id);
    groups.push({
      id: g.id,
      name: g.name,
      parentId:
        typeof g.parentId === "string" && g.parentId ? g.parentId : null,
      collapsed: typeof g.collapsed === "boolean" ? g.collapsed : false,
    });
  }

  // 修复缺失父组与环引用：受影响节点提升到根层级
  const fixedParent = new Map<string, string | null>();
  const resolve = (id: string, stack: Set<string>): string | null => {
    if (fixedParent.has(id)) return fixedParent.get(id)!;
    const group = groups.find((g) => g.id === id)!;
    const parent = group.parentId;
    if (parent === null || !groupIds.has(parent) || stack.has(parent)) {
      if (parent !== null) {
        warnings.push(
          parent && !groupIds.has(parent)
            ? `编组「${group.name}」的父编组已缺失，已移到根层级`
            : `编组「${group.name}」存在循环归属，已移到根层级`,
        );
      }
      fixedParent.set(id, null);
      return null;
    }
    stack.add(id);
    const resolved = resolve(parent, stack);
    stack.delete(id);
    fixedParent.set(id, resolved);
    return resolved;
  };
  for (const g of groups) resolve(g.id, new Set());
  for (const g of groups) g.parentId = fixedParent.get(g.id) ?? null;

  // 编组混音：损坏数据回退默认，多余键丢弃
  const rawGroupsMix = object(raw.groupsMix) ? raw.groupsMix : {};
  const groupsMix: Record<string, Channel> = {};
  for (const id of groupIds) {
    const mix = channel(rawGroupsMix[id]);
    groupsMix[id] = mix ?? { volume: 0.75, muted: false };
  }

  // 轨道归属：未知编组回退根层级
  const rawTrackGroups = object(raw.trackGroups) ? raw.trackGroups : {};
  const trackGroups: Record<string, string | null> = {};
  for (const t of tracks) {
    const owner = rawTrackGroups[t.id];
    const valid = typeof owner === "string" && groupIds.has(owner) ? owner : null;
    if (owner && !valid)
      warnings.push(`轨道「${t.name}」的所属编组已缺失，已移到根层级`);
    trackGroups[t.id] = valid;
  }

  const session: ValidatedSession = {
    version: 2,
    title: raw.title as string,
    bpm: raw.bpm as number,
    beats,
    tracks,
    groups,
    trackGroups,
    channels,
    groupsMix,
    master: raw.master as number,
  };
  if (warnings.length) session.warnings = warnings;
  return session;
}
