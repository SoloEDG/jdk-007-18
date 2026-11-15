import { createEngine, bindPerformanceInput } from "@/features/instruments";
import { createTransport, scheduleWindow } from "@/features/transport";
import { createRecorder } from "@/features/recorder";
import {
  createArrangement,
  demoSession,
  saveSession,
  loadSession,
} from "@/features/arrangement";
import { createMixer } from "@/features/mixer";
import { buildTopology } from "@/features/mixer/lib/topology";
import type { NoteInput, Instrument, Session } from "@/shared/types";

export function createStudio(notify: () => void) {
  const engine = createEngine(),
    transport = createTransport(),
    recorder = createRecorder(),
    arrangement = createArrangement(),
    mixer = createMixer();
  const active = new Set<string>();
  let message = "欢迎来到夜航。戴上耳机，试着敲下第一拍。",
    epoch = 0,
    disposed = false;
  const now = () => engine.context?.currentTime ?? 0;
  const feedback = (text: string) => {
    message = text;
    notify();
  };
  const guard = (fn: () => void) => {
    try {
      fn();
      notify();
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "操作失败，现有作品已保留",
      );
    }
  };
  const locked = () => recorder.snapshot().status !== "idle";
  /** 把编排里的层级树同步成音频节点拓扑；播放中调用即平滑改接 */
  const syncTopology = () => {
    const data = arrangement.topologyData();
    const groupIds = new Set(data.groups.map((g) => g.id));
    mixer.setTopology(
      buildTopology(data.groups, data.trackGroups, data.trackIds),
      (id) => (groupIds.has(id) ? "group" : "track"),
    );
  };
  const cancelVoices = () => {
    engine.cancel();
    active.clear();
  };
  const stop = () => {
    epoch++;
    transport.stop();
    recorder.cancel();
    cancelVoices();
    notify();
  };
  const pause = () => {
    epoch++;
    transport.pause(now());
    recorder.cancel();
    cancelVoices();
    feedback("播放已暂停；未完成录音已取消，原片段保留。");
  };
  const unlock = async () => {
    const context = await engine.unlock();
    if (disposed) return false;
    mixer.attach(context);
    syncTopology();
    engine.route(mixer.channel);
    return true;
  };
  const play = async () => {
    const token = ++epoch;
    try {
      if (!(await unlock()) || token !== epoch) return;
      transport.start(now() + 0.02);
      tick();
      notify();
    } catch {
      feedback("声音启动失败，请再次点击播放");
    }
  };
  const tick = () => {
    const time = now(),
      view = transport.view(time);
    const take = recorder.advance(view.absolute);
    if (take)
      guard(() => {
        arrangement.commit(take.trackId, take.notes);
        message = `录制完成 · ${take.notes.length} 个音符`;
      });
    const capture = recorder.snapshot();
    const ceiling =
      capture.status === "idle" ? Infinity : capture.start + capture.length;
    const window = transport.window(time, ceiling);
    if (window)
      scheduleWindow(
        arrangement.forPlayback(),
        window.from,
        window.to,
        view.beats,
        view.bpm,
        window.timeAt,
        (n) => engine.play(n),
      );
  };
  const down = async (id: string, note: NoteInput) => {
    if (active.has(id)) return;
    active.add(id);
    notify();
    try {
      if (!(await unlock()) || !active.has(id)) return;
      const target = arrangement.selectedTrack();
      if (!target || target.instrument !== note.instrument) {
        active.delete(id);
        feedback("请先选择对应乐器的轨道");
        return;
      }
      const abs = transport.view(now()).absolute;
      const take = recorder.advance(abs);
      if (take) arrangement.commit(take.trackId, take.notes);
      recorder.down(id, note, abs);
      engine.play(
        {
          ...note,
          trackId: target.id,
          duration: note.instrument === "keys" ? 6 : 0.3,
          when: now(),
        },
        id,
      );
    } catch {
      active.delete(id);
      feedback("请点击播放以启用声音");
    }
  };
  const up = (id: string) => {
    if (!active.delete(id)) return;
    recorder.up(id, transport.view(now()).absolute);
    engine.release(id);
    notify();
  };
  const install = (session: Session, warnings: string[] = []) => {
    stop();
    const valid = arrangement.restore(session);
    transport.configure(valid.bpm, valid.beats);
    const data = arrangement.topologyData();
    mixer.restore(
      valid.channels,
      valid.groupsMix,
      valid.master,
      buildTopology(data.groups, data.trackGroups, data.trackIds),
    );
    if (warnings.length)
      feedback(`恢复完成但有 ${warnings.length} 处归属缺失，已安全提升到根层级：${warnings.join("；")}`);
    notify();
  };
  const timer = window.setInterval(() => {
    tick();
    notify();
  }, 20);
  const unbind = bindPerformanceInput((id, note) => void down(id, note), up);
  const shortcut = (e: KeyboardEvent) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
    ) {
      e.preventDefault();
      if (transport.view(now()).running) pause();
      else void play();
    }
  };
  const blur = () => {
    for (const id of [...active]) up(id);
  };
  window.addEventListener("keydown", shortcut);
  window.addEventListener("blur", blur);
  return {
    view() {
      return {
        transport: transport.view(now()),
        arrangement: arrangement.snapshot(),
        selected: arrangement.selected(),
        selectedTrack: arrangement.selectedTrack(),
        recorder: recorder.snapshot(),
        mixer: mixer.snapshot(),
        active: new Set(active),
        message,
      };
    },
    play,
    pause,
    stop,
    down: (id: string, n: NoteInput) => void down(id, n),
    up,
    configure(bpm: number, beats: number) {
      stop();
      transport.configure(bpm, beats);
      arrangement.resizeLoop(transport.view(now()).beats);
      feedback("速度或长度变更：播放回到起点；缩短时移除范围外音符。");
    },
    add(kind: Instrument) {
      guard(() => {
        arrangement.add(kind);
        syncTopology();
      });
    },
    addGroup(name?: string) {
      guard(() => {
        arrangement.addGroup(name);
        syncTopology();
      });
    },
    select(id: string, kind: "track" | "group") {
      arrangement.select(id, kind);
      if (kind === "track" && !locked()) {
        engine.releaseHeld();
        active.clear();
      }
      notify();
    },
    renameGroup(id: string, name: string) {
      guard(() => arrangement.renameGroup(id, name));
    },
    toggleCollapse(id: string) {
      guard(() => arrangement.toggleCollapse(id));
    },
    moveTrack(trackId: string, groupId: string | null) {
      guard(() => {
        arrangement.moveTrack(trackId, groupId, locked());
        syncTopology();
        if (!locked())
          message = groupId
            ? "轨道已移入新编组，播放路径平滑切换"
            : "轨道已移出编组，直连主输出";
      });
    },
    reparentGroup(groupId: string, parentId: string | null) {
      guard(() => {
        arrangement.reparentGroup(groupId, parentId, locked());
        syncTopology();
      });
    },
    removeGroup(id: string, dissolve: boolean) {
      guard(() => {
        stop();
        arrangement.removeGroup(id, dissolve, locked());
        syncTopology();
        message = dissolve
          ? "编组已解散，子轨设置全部保留"
          : "编组连同组内轨道已删除";
      });
    },
    remove() {
      guard(() => {
        const selected = arrangement.selectedTrack();
        if (selected) {
          stop();
          arrangement.remove(selected.id);
          syncTopology();
        }
      });
    },
    clear() {
      guard(() => {
        const t = arrangement.selectedTrack();
        if (t) {
          stop();
          arrangement.clear(t.id);
        }
      });
    },
    async record() {
      const selected = arrangement.selectedTrack();
      if (!selected) return;
      const token = ++epoch;
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) transport.start(now() + 0.02);
        recorder.arm(
          selected.id,
          selected.instrument,
          transport.view(now()).absolute,
          state.beats,
        );
        tick();
        notify();
      } catch {
        feedback("录音启动失败，请重试");
      }
    },
    cancel() {
      recorder.cancel();
      feedback("本次录音已取消，之前的片段仍然保留。");
    },
    grid(n: number) {
      recorder.grid(n);
      notify();
    },
    volume(id: string, n: number) {
      mixer.volume(id, n);
      notify();
    },
    mute(id: string) {
      mixer.mute(id);
      notify();
    },
    groupVolume(id: string, n: number) {
      mixer.groupVolume(id, n);
      notify();
    },
    groupMute(id: string) {
      mixer.groupMute(id);
      notify();
    },
    master(n: number) {
      mixer.master(n);
      notify();
    },
    demo() {
      guard(() => {
        const session = demoSession();
        install(session);
        message = "示范已载入 · 点击播放，听听凌晨两点。";
      });
    },
    save() {
      guard(() => {
        if (locked())
          throw new Error("请完成或取消录音后再保存");
        const a = arrangement.snapshot(),
          t = transport.view(now()),
          m = mixer.snapshot();
        const session: Session = {
          version: 2,
          title: a.title,
          bpm: t.bpm,
          beats: t.beats,
          tracks: a.tracks,
          groups: a.groups,
          trackGroups: a.trackGroups,
          channels: m.channels,
          groupsMix: m.groupsMix,
          master: m.master,
        };
        saveSession(session);
        message = "作品已保存到本机浏览器（含编组层级与各级混音）";
      });
    },
    load() {
      guard(() => {
        const session = loadSession();
        install(session, session.warnings ?? []);
        message = session.warnings?.length
          ? message
          : "本地作品已恢复（含编组层级）";
      });
    },
    dispose() {
      disposed = true;
      epoch++;
      clearInterval(timer);
      unbind();
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("blur", blur);
      mixer.dispose();
      engine.dispose();
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
