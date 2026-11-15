import type { Channel, Track } from "@/shared/types";
import { decibels } from "../lib/levels";

export function TrackStrip({
  track,
  channel,
  depth,
  badge,
  running,
  selected,
  volume,
  mute,
  select,
  onDragStart,
  onDragEnd,
}: {
  track: Track;
  channel: Channel;
  depth: number;
  /** 折叠隐藏时由编组条代显的归属标记 */
  badge?: string;
  running: boolean;
  selected: boolean;
  volume: (n: number) => void;
  mute: () => void;
  select: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`channel-strip track-strip ${channel.muted ? "muted" : ""} ${
        selected ? "selected" : ""
      }`}
      style={{ marginLeft: depth * 18 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "track", id: track.id }));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="strip-head">
        <button className="strip-name" onClick={select} title={badge ?? track.name}>
          <span className="color-dot" style={{ background: track.color }} />
          <strong>{track.name}</strong>
          {badge && <small className="group-badge">{badge}</small>}
        </button>
        <button
          className="mute-btn"
          onClick={mute}
          aria-label={`${channel.muted ? "取消静音" : "静音"} ${track.name}`}
          aria-pressed={channel.muted}
        >
          M
        </button>
      </div>
      <div className="fader-line">
        <input
          aria-label={`${track.name} 音量`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={channel.volume}
          onChange={(e) => volume(Number(e.target.value))}
        />
        <span>{decibels(channel.muted ? 0 : channel.volume)}</span>
      </div>
      <div className="level-track">
        <i
          style={{
            width: `${running && !channel.muted ? channel.volume * 100 : 0}%`,
            background: track.color,
          }}
        />
      </div>
    </div>
  );
}
