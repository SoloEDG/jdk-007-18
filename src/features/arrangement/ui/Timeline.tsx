import type { Track, Note, Group } from "@/shared/types";
import { indexGroups, depthOf } from "@/shared/groups";

export function Timeline({
  tracks,
  groups,
  trackGroups,
  selected,
  position,
  beats,
  draft,
  select,
}: {
  tracks: readonly Track[];
  groups: readonly Group[];
  trackGroups: Record<string, string | null>;
  selected: string | null;
  position: number;
  beats: number;
  draft: readonly Note[];
  select: (id: string) => void;
}) {
  const groupMap = indexGroups(groups);
  const ownerLabel = (trackId: string): string | null => {
    const owner = trackGroups[trackId];
    return owner ? (groupMap.get(owner)?.name ?? null) : null;
  };

  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ minWidth: 500 }}>
        <div className="ruler">
          <span>轨道 / TRACK</span>
          <div>
            {Array.from({ length: beats / 4 }, (_, i) => (
              <b key={i}>{String(i + 1).padStart(2, "0")}</b>
            ))}
          </div>
        </div>
        {tracks.map((track, i) => {
          const owner = trackGroups[track.id] ?? null;
          const depth = owner ? depthOf(owner, groupMap) + 1 : 0;
          const label = ownerLabel(track.id);
          return (
            <div
              className={`lane ${selected === track.id ? "selected" : ""}`}
              key={track.id}
              style={{ paddingLeft: depth * 16 }}
            >
              <button className="lane-name" onClick={() => select(track.id)}>
                <span style={{ color: track.color }}>0{i + 1}</span>
                <strong>{track.name}</strong>
                {label && <small className="lane-group">▣ {label}</small>}
                <small>
                  {track.instrument === "drums" ? "DRUM MACHINE" : "POLY SYNTH"}
                </small>
              </button>
              <div
                className="lane-notes"
                style={{ "--bars": beats / 4 } as React.CSSProperties}
              >
                {[
                  ...track.notes,
                  ...(selected === track.id ? draft : []),
                ].map((n) => (
                  <span
                    className={`note-block ${draft.includes(n) ? "draft" : ""}`}
                    key={n.id}
                    style={{
                      left: `${(n.beat / beats) * 100}%`,
                      width: `${Math.max(0.6, (Math.min(n.duration, beats - n.beat) / beats) * 100)}%`,
                      top: `${12 + (track.instrument === "drums" ? n.pitch : (((72 - n.pitch) % 12) + 12) % 12) * 3}%`,
                      background: track.color,
                    }}
                  />
                ))}
                <i
                  className="playhead"
                  style={{ left: `${(position / beats) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
        {tracks.length === 0 && (
          <div className="empty-arrangement">
            <span>♫</span>
            <h3>第一拍，从你开始</h3>
            <p>添加鼓组或琴键轨道，录下属于你的循环。</p>
          </div>
        )}
      </div>
    </div>
  );
}
