import { useState } from "react";
import type { Channel, Group } from "@/shared/types";
import { decibels } from "../lib/levels";

export function GroupStrip({
  group,
  channel,
  depth,
  selected,
  dropActive,
  hiddenSelected,
  childCount,
  running,
  onToggle,
  onVolume,
  onMute,
  onSelect,
  onRename,
  onDropNode,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragHover,
  onDragLeave,
}: {
  group: Group;
  channel: Channel;
  depth: number;
  selected: boolean;
  dropActive: boolean;
  /** 折叠状态下，当前选中项藏在本组子树里时的提示 */
  hiddenSelected: string | null;
  childCount: number;
  running: boolean;
  onToggle: () => void;
  onVolume: (n: number) => void;
  onMute: () => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  /** 拖入轨道或子编组，参数为来源类型与 id */
  onDropNode: (kind: "track" | "group", id: string) => void;
  onRemove: (dissolve: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragHover: () => void;
  onDragLeave: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const [menuOpen, setMenuOpen] = useState(false);

  const commitRename = () => {
    if (draft.trim()) onRename(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={`channel-strip group-strip ${channel.muted ? "muted" : ""} ${
        selected ? "selected" : ""
      } ${dropActive ? "drop-target" : ""}`}
      style={{ marginLeft: depth * 18 }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "group", id: group.id }));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        e.stopPropagation();
        onDragHover();
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeave();
        try {
          const payload = JSON.parse(e.dataTransfer.getData("text/plain")) as {
            kind: "track" | "group";
            id: string;
          };
          if (payload.id) onDropNode(payload.kind, payload.id);
        } catch {
          /* 非内部拖放，忽略 */
        }
      }}
    >
      <div className="strip-head">
        <button
          className="collapse-btn"
          onClick={onToggle}
          aria-label={group.collapsed ? `展开 ${group.name}` : `折叠 ${group.name}`}
          aria-expanded={!group.collapsed}
        >
          {group.collapsed ? "▸" : "▾"}
        </button>
        <span className="group-mark" title="编组">
          ▣
        </span>
        {editing ? (
          <input
            className="group-name-input"
            autoFocus
            value={draft}
            maxLength={32}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(group.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button className="strip-name" onClick={onSelect} onDoubleClick={() => setEditing(true)}>
            <strong>{group.name}</strong>
            <small>{childCount} 子项</small>
          </button>
        )}
        <button
          className="mute-btn group-mute"
          onClick={onMute}
          aria-label={`${channel.muted ? "取消编组静音" : "编组静音"} ${group.name}`}
          aria-pressed={channel.muted}
        >
          M
        </button>
        <div className="group-menu-wrap">
          <button
            className="menu-btn"
            aria-label={`${group.name} 更多操作`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="group-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setDraft(group.name);
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                重命名
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  onRemove(true);
                  setMenuOpen(false);
                }}
              >
                解散编组（保留子轨）
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  onRemove(false);
                  setMenuOpen(false);
                }}
              >
                删除编组及组内轨道
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="fader-line">
        <input
          aria-label={`${group.name} 编组音量`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={channel.volume}
          onChange={(e) => onVolume(Number(e.target.value))}
        />
        <span>{decibels(channel.muted ? 0 : channel.volume)}</span>
      </div>
      <div className="level-track">
        <i
          className="group-level"
          style={{
            width: `${running && !channel.muted ? channel.volume * 100 : 0}%`,
          }}
        />
      </div>
      {group.collapsed && hiddenSelected && (
        <p className="hidden-selection" role="status">
          当前选中「{hiddenSelected}」隐藏在本组内
        </p>
      )}
    </div>
  );
}
