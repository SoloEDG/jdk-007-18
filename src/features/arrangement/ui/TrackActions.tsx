import type { Instrument, Track } from "@/shared/types";

export function TrackActions({
  selected,
  count,
  groupCount,
  locked,
  add,
  addGroup,
  remove,
  clear,
}: {
  selected: Track | null;
  count: number;
  groupCount: number;
  locked: boolean;
  add: (kind: Instrument) => void;
  addGroup: () => void;
  remove: () => void;
  clear: () => void;
}) {
  return (
    <div className="track-actions">
      <button disabled={locked || count >= 8} onClick={() => add("drums")}>
        ＋ 鼓组轨道
      </button>
      <button disabled={locked || count >= 8} onClick={() => add("keys")}>
        ＋ 琴键轨道
      </button>
      <button
        className="add-group-btn"
        disabled={groupCount >= 16}
        onClick={addGroup}
        title="新建可折叠的轨道编组"
      >
        ＋ 编组
      </button>
      <span>{count} / 8 轨道 · {groupCount} 编组</span>
      <button
        disabled={locked || !selected || !selected.notes.length}
        onClick={clear}
      >
        清空音符
      </button>
      <button
        disabled={locked || !selected}
        onClick={remove}
        aria-label="删除选中轨道"
      >
        删除轨道
      </button>
    </div>
  );
}
