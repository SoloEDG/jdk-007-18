import { useStudio } from "./useStudio";
import { TransportBar, BeatLights } from "@/features/transport";
import { Pads, Keyboard } from "@/features/instruments";
import { Timeline, TrackActions } from "@/features/arrangement";
import { RecordControls, RecordingStatus } from "@/features/recorder";
import { MixerPanel } from "@/features/mixer";
export function App() {
  const s = useStudio();
  if (!s) return <div className="loading">正在打开夜航工作室…</div>;
  const v = s.view(),
    locked = v.recorder.status !== "idle";
  const selectedTrack =
    v.selected?.kind === "track" ? v.selected.track : null;
  return (
    <div className="studio-shell">
      <aside className="rail">
        <a href="#workspace" className="brand-mark" aria-label="夜航工作室">
          n<span>↗</span>
        </a>
        <span className="rail-icon active" title="工作室">
          ▥
        </span>
        <span className="rail-label">NIGHTSHIFT</span>
        <span className="rail-bottom">01</span>
      </aside>
      <main id="workspace">
        <header>
          <div>
            <div className="eyebrow">YOUR IDEAS, IN THE LOOP.</div>
            <h1>
              夜航<span> / </span>
              <em>Nightshift</em>
              <sup>STUDIO</sup>
            </h1>
            <p>让灵感，循环发生。</p>
          </div>
          <div className="header-actions">
            <span className="local-badge">
              <i /> 本地工作空间
            </span>
            <button onClick={s.load}>↺ 恢复</button>
            <button className="save" onClick={s.save}>
              保存作品 ↗
            </button>
          </div>
        </header>
        <div className="session-title">
          <span>当前作品</span>
          <strong>{v.arrangement.title}</strong>
          <button disabled={locked} onClick={s.demo}>
            试听示范 ↗
          </button>
        </div>
        <TransportBar
          view={v.transport}
          play={() => void s.play()}
          pause={s.pause}
          stop={s.stop}
          configure={s.configure}
          disabled={locked}
        />
        <div className="workspace-grid">
          <section className="panel arrangement-panel">
            <div className="section-heading">
              <div>
                <small>01 / ARRANGE</small>
                <h2>
                  循环编排<span>{v.transport.beats / 4} BARS</span>
                </h2>
              </div>
              <BeatLights
                position={v.transport.position}
                running={v.transport.running}
              />
            </div>
            <TrackActions
              selected={selectedTrack}
              count={v.arrangement.tracks.length}
              groupCount={v.arrangement.groups.length}
              locked={locked}
              add={s.add}
              addGroup={() => s.addGroup()}
              clear={s.clear}
              remove={s.remove}
            />
            <Timeline
              tracks={v.arrangement.tracks}
              groups={v.arrangement.groups}
              trackGroups={v.arrangement.trackGroups}
              selected={
                v.selected?.kind === "track" ? v.arrangement.selected : null
              }
              position={v.transport.position}
              beats={v.transport.beats}
              draft={v.recorder.draft}
              select={(id) => s.select(id, "track")}
            />
            <div className="arrangement-footer">
              <span>
                <i className="color-dot" />{" "}
                {selectedTrack
                  ? `已选择 ${selectedTrack.name}`
                  : v.selected?.kind === "group"
                    ? `已选择编组「${v.selected.group.name}」`
                    : "选择一条轨道开始演奏"}
              </span>
              <span>4/4 拍 · 最多 8 条轨道</span>
            </div>
          </section>
          <MixerPanel
            tracks={v.arrangement.tracks}
            groups={v.arrangement.groups}
            trackGroups={v.arrangement.trackGroups}
            channels={v.mixer.channels}
            groupsMix={v.mixer.groupsMix}
            master={v.mixer.master}
            selected={v.arrangement.selected}
            selectedKind={v.arrangement.selectedKind}
            running={v.transport.running}
            volume={s.volume}
            mute={s.mute}
            groupVolume={s.groupVolume}
            groupMute={s.groupMute}
            setMaster={s.master}
            select={s.select}
            toggleCollapse={s.toggleCollapse}
            renameGroup={s.renameGroup}
            moveTrack={s.moveTrack}
            reparentGroup={s.reparentGroup}
            removeGroup={s.removeGroup}
          />
          <section className="panel performance-panel">
            <div className="section-heading">
              <div>
                <small>02 / PERFORM</small>
                <h2>
                  演奏台
                  <span>
                    {selectedTrack?.instrument === "keys"
                      ? "POLY SYNTH"
                      : "DRUM MACHINE"}
                  </span>
                </h2>
              </div>
              <RecordControls
                state={v.recorder}
                canRecord={!!selectedTrack}
                record={() => void s.record()}
                cancel={s.cancel}
                setGrid={s.grid}
              />
            </div>
            <div className="instrument-label">
              <span>
                {selectedTrack?.instrument === "keys"
                  ? "柔和三角波 / WARM TRIANGLE"
                  : "经典合成鼓组 / ANALOG KIT"}
              </span>
              <span>鼠标 · 触控 · 键盘</span>
            </div>
            {selectedTrack?.instrument === "keys" ? (
              <Keyboard active={v.active} down={s.down} up={s.up} />
            ) : (
              <Pads active={v.active} down={s.down} up={s.up} />
            )}
            <RecordingStatus
              state={v.recorder}
              absolute={v.transport.absolute}
            />
          </section>
        </div>
        <footer>
          <span role="status">{v.message}</span>
          <span>
            <kbd>Space</kbd> 播放 / 暂停 <b>·</b>{" "}
            {selectedTrack?.instrument === "keys"
              ? "A – K 演奏琴键"
              : "Q W E R 演奏鼓组"}
          </span>
        </footer>
      </main>
    </div>
  );
}
