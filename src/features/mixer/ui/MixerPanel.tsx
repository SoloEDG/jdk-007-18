import { useMemo, useState } from "react";
import type { Track, Group, Channel } from "@/shared/types";
import { indexGroups } from "@/shared/groups";
import { GroupStrip } from "./GroupStrip";
import { TrackStrip } from "./TrackStrip";

type DragInfo = { kind: "track" | "group"; id: string } | null;

export function MixerPanel({
  tracks,
  groups,
  trackGroups,
  channels,
  groupsMix,
  master,
  selected,
  selectedKind,
  running,
  volume,
  mute,
  groupVolume,
  groupMute,
  setMaster,
  select,
  toggleCollapse,
  renameGroup,
  moveTrack,
  reparentGroup,
  removeGroup,
}: {
  tracks: readonly Track[];
  groups: readonly Group[];
  trackGroups: Record<string, string | null>;
  channels: Record<string, Channel>;
  groupsMix: Record<string, Channel>;
  master: number;
  selected: string | null;
  selectedKind: "track" | "group";
  running: boolean;
  volume: (id: string, n: number) => void;
  mute: (id: string) => void;
  groupVolume: (id: string, n: number) => void;
  groupMute: (id: string) => void;
  setMaster: (n: number) => void;
  select: (id: string, kind: "track" | "group") => void;
  toggleCollapse: (id: string) => void;
  renameGroup: (id: string, name: string) => void;
  moveTrack: (trackId: string, groupId: string | null) => void;
  reparentGroup: (groupId: string, parentId: string | null) => void;
  removeGroup: (groupId: string, dissolve: boolean) => void;
}) {
  const [drag, setDrag] = useState<DragInfo>(null);
  const [rootHover, setRootHover] = useState(false);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const groupMap = useMemo(() => indexGroups(groups), [groups]);
  const collapsedSet = useMemo(
    () => new Set(groups.filter((g) => g.collapsed).map((g) => g.id)),
    [groups],
  );

  /** 任一祖先折叠则节点隐藏 */
  const hiddenByAncestor = (owner: string | null): boolean =>
    nearestCollapsedAncestor(owner) !== null;

  /** 返回导致该节点被隐藏的最近折叠祖先编组 id，无则 null */
  const nearestCollapsedAncestor = (owner: string | null): string | null => {
    let cursor = owner;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) return null;
      seen.add(cursor);
      if (collapsedSet.has(cursor)) return cursor;
      cursor = groupMap.get(cursor)?.parentId ?? null;
    }
    return null;
  };

  const ownerName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return groupMap.get(id)?.name;
  };

  const dropOnGroup = (targetId: string, info: Exclude<DragInfo, null>) => {
    // 统一交给模型层校验：非法拖放（自身/后代）会抛出并给出提示
    if (info.kind === "track") moveTrack(info.id, targetId);
    else reparentGroup(info.id, targetId);
  };

  const dropOnRoot = (info: Exclude<DragInfo, null>) => {
    if (info.kind === "track") moveTrack(info.id, null);
    else reparentGroup(info.id, null);
  };

  /** 收集某编组子树（含后代编组）下的全部轨道 id */
  const tracksInSubtree = (groupId: string): Set<string> => {
    const ids = new Set<string>();
    const walk = (gid: string) => {
      for (const t of tracks)
        if ((trackGroups[t.id] ?? null) === gid) ids.add(t.id);
      for (const g of groups) if (g.parentId === gid) walk(g.id);
    };
    walk(groupId);
    return ids;
  };

  const renderGroup = (group: Group, depth: number) => {
    const childGroups = groups.filter((g) => g.parentId === group.id);
    const childTracks = tracks.filter(
      (t) => (trackGroups[t.id] ?? null) === group.id,
    );
    // 折叠时，若被选中的轨道藏在本组（任意层级）子树里，明确提示所属组
    const hiddenSelectedTrack =
      group.collapsed && selectedKind === "track" && selected
        ? tracks.find((t) => t.id === selected && tracksInSubtree(group.id).has(t.id))
            ?.name ?? null
        : null;
    return (
      <div className="group-block" key={group.id}>
        <GroupStrip
          group={group}
          channel={groupsMix[group.id] ?? { volume: 0.75, muted: false }}
          depth={depth}
          selected={selected === group.id && selectedKind === "group"}
          dropActive={hoverGroup === group.id && drag?.id !== group.id}
          hiddenSelected={hiddenSelectedTrack}
          childCount={childGroups.length + childTracks.length}
          running={running}
          onToggle={() => toggleCollapse(group.id)}
          onVolume={(n) => groupVolume(group.id, n)}
          onMute={() => groupMute(group.id)}
          onSelect={() => select(group.id, "group")}
          onRename={(name) => renameGroup(group.id, name)}
          onDropNode={(kind, id) => dropOnGroup(group.id, { kind, id })}
          onRemove={(dissolve) => removeGroup(group.id, dissolve)}
          onDragStart={() => setDrag({ kind: "group", id: group.id })}
          onDragEnd={() => {
            setDrag(null);
            setHoverGroup(null);
          }}
          onDragHover={() => setHoverGroup(group.id)}
          onDragLeave={() =>
            setHoverGroup((cur) => (cur === group.id ? null : cur))
          }
        />
        {!group.collapsed && (
          <>
            {childGroups.map((g) => renderGroup(g, depth + 1))}
            {childTracks.map((t) =>
              renderTrack(t, depth + 1, group.id),
            )}
          </>
        )}
      </div>
    );
  };

  const renderTrack = (
    track: Track,
    depth: number,
    owner: string | null,
  ) => {
    if (hiddenByAncestor(owner)) return null;
    return (
      <TrackStrip
        key={track.id}
        track={track}
        channel={channels[track.id] ?? { volume: 0.75, muted: false }}
        depth={depth}
        badge={owner ? ownerName(owner) : undefined}
        running={running}
        selected={selected === track.id && selectedKind === "track"}
        volume={(n) => volume(track.id, n)}
        mute={() => mute(track.id)}
        select={() => select(track.id, "track")}
        onDragStart={() => setDrag({ kind: "track", id: track.id })}
        onDragEnd={() => {
          setDrag(null);
          setRootHover(false);
          setHoverGroup(null);
        }}
      />
    );
  };

  const rootGroups = groups.filter((g) => g.parentId === null);
  const rootTracks = tracks.filter((t) => (trackGroups[t.id] ?? null) === null);
  const empty = tracks.length === 0 && groups.length === 0;

  return (
    <section className="panel mixer-panel">
      <div className="section-heading">
        <div>
          <small>03 / BALANCE</small>
          <h2>混音台</h2>
        </div>
        <span className="tag">GROUP BUS</span>
      </div>
      {empty ? (
        <p className="empty-small">添加轨道后，在这里平衡每一种声音。</p>
      ) : (
        <div
          className={`mixer-tree ${rootHover ? "root-hover" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // 悬停在编组条上时由该编组高亮；其余空白区域高亮整棵树表示移到根层级
            setRootHover(
              !(e.target as HTMLElement).closest(".group-strip"),
            );
          }}
          onDragLeave={(e) => {
            // 仅当指针真正离开整棵树时才取消高亮
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setRootHover(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setRootHover(false);
            setHoverGroup(null);
            // 编组条的 drop 已自行 stopPropagation；落到轨道条/空白处才视为移到根层级
            if (!(e.target as HTMLElement).closest(".group-strip") && drag)
              dropOnRoot(drag);
            setDrag(null);
          }}
        >
          {rootGroups.map((g) => renderGroup(g, 0))}
          {rootTracks.map((t) => renderTrack(t, 0, null))}
          <p className="root-drop-hint">拖到此处可移出编组 · 直连主输出</p>
        </div>
      )}
      <div className="master">
        <div>
          <strong>主输出</strong>
          <span>{Math.round(master * 100)}%</span>
        </div>
        <input
          aria-label="主音量"
          type="range"
          min="0"
          max="1"
          step=".01"
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
        />
        <small>子轨 → 编组 → 主输出 · 编组静音不改子轨推子</small>
      </div>
    </section>
  );
}
