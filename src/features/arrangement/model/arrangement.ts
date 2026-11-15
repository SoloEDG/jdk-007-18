import type {
  Track,
  Instrument,
  Note,
  Session,
  Group,
} from "@/shared/types";
import { uid } from "@/shared/math";
import { canReparent, indexGroups } from "@/shared/groups";
import { validateSession } from "../lib/validation";

const MAX_TRACKS = 8;
const MAX_GROUPS = 16;

export function createArrangement() {
  let tracks: Track[] = [],
    groups: Group[] = [],
    trackGroups: Record<string, string | null> = {},
    selected: string | null = null,
    selectedKind: "track" | "group" = "track",
    title = "未命名夜航";
  const colors = [
    "#d5f377",
    "#bca5f4",
    "#8fbfff",
    "#f4af84",
    "#80cfbb",
    "#ed94b4",
    "#cec080",
    "#a6b6c9",
  ];
  const groupIndex = () => indexGroups(groups);
  const existsGroup = (id: string | null) =>
    id === null || groups.some((g) => g.id === id);

  return {
    snapshot() {
      return {
        tracks: structuredClone(tracks),
        groups: structuredClone(groups),
        trackGroups: structuredClone(trackGroups),
        selected,
        selectedKind,
        title,
      };
    },
    selected() {
      if (selectedKind === "group") {
        const group = groups.find((g) => g.id === selected);
        return group ? { kind: "group" as const, group: structuredClone(group) } : null;
      }
      const track = tracks.find((t) => t.id === selected);
      return track ? { kind: "track" as const, track: structuredClone(track) } : null;
    },
    selectedTrack() {
      const track = tracks.find((t) => t.id === selected);
      return track ? structuredClone(track) : null;
    },
    select(id: string, kind: "track" | "group") {
      if (kind === "group") {
        if (!groups.some((g) => g.id === id)) return;
      } else if (!tracks.some((t) => t.id === id)) return;
      selected = id;
      selectedKind = kind;
    },
    add(instrument: Instrument) {
      if (tracks.length >= MAX_TRACKS)
        throw new Error(`最多支持 ${MAX_TRACKS} 条轨道，请先移除一条`);
      const t: Track = {
        id: uid(),
        name: `${instrument === "drums" ? "鼓组" : "琴键"} ${tracks.length + 1}`,
        instrument,
        color: colors[tracks.length % colors.length],
        notes: [],
      };
      tracks = [...tracks, t];
      trackGroups = { ...trackGroups, [t.id]: null };
      selected = t.id;
      selectedKind = "track";
      return t.id;
    },
    addGroup(name?: string, parentId: string | null = null) {
      if (groups.length >= MAX_GROUPS)
        throw new Error(`最多支持 ${MAX_GROUPS} 个编组`);
      if (!existsGroup(parentId)) throw new Error("父编组不存在");
      const group: Group = {
        id: uid(),
        name: name?.trim() || `编组 ${groups.length + 1}`,
        parentId,
        collapsed: false,
      };
      groups = [...groups, group];
      selected = group.id;
      selectedKind = "group";
      return group.id;
    },
    renameGroup(id: string, name: string) {
      const next = name.trim();
      if (!next) throw new Error("编组名称不能为空");
      groups = groups.map((g) =>
        g.id === id ? { ...g, name: next.slice(0, 32) } : g,
      );
    },
    /** 折叠只影响界面展示，录音与播放仍覆盖组内全部轨道 */
    toggleCollapse(id: string) {
      groups = groups.map((g) =>
        g.id === id ? { ...g, collapsed: !g.collapsed } : g,
      );
    },
    /**
     * 把轨道移入另一编组。归属与录音提交是两条独立状态：
     * 录音进行中直接拒绝，保证一次录音的提交目标不会在中途变化。
     */
    moveTrack(trackId: string, groupId: string | null, locked: boolean) {
      if (locked) throw new Error("录音进行中不能调整轨道归属");
      if (!tracks.some((t) => t.id === trackId))
        throw new Error("轨道不存在");
      if (!existsGroup(groupId)) throw new Error("目标编组不存在");
      if ((trackGroups[trackId] ?? null) === groupId) return;
      trackGroups = { ...trackGroups, [trackId]: groupId };
    },
    /** 调整编组层级，拒绝拖入自身或后代 */
    reparentGroup(groupId: string, nextParentId: string | null, locked: boolean) {
      if (locked) throw new Error("录音进行中不能调整编组层级");
      const map = groupIndex();
      if (!canReparent(groupId, nextParentId, map))
        throw new Error("不能把编组拖入它自己或它的子编组");
      groups = groups.map((g) =>
        g.id === groupId ? { ...g, parentId: nextParentId } : g,
      );
    },
    /**
     * 删除编组：
     * - dissolve：解散，子轨/子编组提升到被删编组的父级，全部设置保留
     * - 否则连同组内所有子轨一起删除（子编组提升保留，仅删轨道）
     */
    removeGroup(id: string, dissolve: boolean, locked: boolean) {
      if (locked) throw new Error("录音进行中不能删除编组");
      const target = groups.find((g) => g.id === id);
      if (!target) return;
      const parentId = target.parentId;
      // 直接子编组提升一层
      groups = groups
        .filter((g) => g.id !== id)
        .map((g) => (g.parentId === id ? { ...g, parentId } : g));
      const childTracks = tracks.filter(
        (t) => (trackGroups[t.id] ?? null) === id,
      );
      if (dissolve) {
        trackGroups = Object.fromEntries(
          Object.entries(trackGroups).map(([trackId, owner]) => [
            trackId,
            owner === id ? parentId : owner,
          ]),
        );
      } else {
        const removed = new Set(childTracks.map((t) => t.id));
        tracks = tracks.filter((t) => !removed.has(t.id));
        trackGroups = Object.fromEntries(
          Object.entries(trackGroups).filter(([trackId]) => !removed.has(trackId)),
        );
      }
      if (
        selected === id ||
        (!dissolve &&
          selected &&
          childTracks.some((t) => t.id === selected))
      ) {
        selected = tracks[0]?.id ?? groups[0]?.id ?? null;
        selectedKind = tracks[0] ? "track" : "group";
      }
    },
    remove(id: string) {
      tracks = tracks.filter((t) => t.id !== id);
      trackGroups = Object.fromEntries(
        Object.entries(trackGroups).filter(([trackId]) => trackId !== id),
      );
      if (selected === id) {
        selected = tracks[0]?.id ?? groups[0]?.id ?? null;
        selectedKind = tracks[0] ? "track" : "group";
      }
    },
    commit(id: string, notes: Note[]) {
      if (!tracks.some((t) => t.id === id)) throw new Error("录音目标已不存在");
      tracks = tracks.map((t) =>
        t.id === id ? { ...t, notes: structuredClone(notes) } : t,
      );
    },
    resizeLoop(beats: number) {
      tracks = tracks.map((track) => ({
        ...track,
        notes: track.notes
          .filter((note) => note.beat < beats)
          .map((note) => ({
            ...note,
            duration: Math.min(note.duration, beats - note.beat),
          })),
      }));
    },
    clear(id: string) {
      this.commit(id, []);
    },
    restore(raw: Session) {
      const session = validateSession(raw);
      tracks = session.tracks;
      groups = session.groups;
      trackGroups = session.trackGroups;
      title = session.title;
      selected = tracks[0]?.id ?? groups[0]?.id ?? null;
      selectedKind = tracks[0] ? "track" : "group";
      return session;
    },
    forPlayback() {
      return structuredClone(tracks);
    },
    topologyData() {
      return {
        groups: structuredClone(groups),
        trackGroups: structuredClone(trackGroups),
        trackIds: tracks.map((t) => t.id),
      };
    },
  };
}
export type Arrangement = ReturnType<typeof createArrangement>;
