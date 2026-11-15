import type { Channel } from "@/shared/types";
import { level } from "../lib/levels";
import { createBuses, type Topology } from "./buses";

const DEFAULT_VOLUME = 0.75;

export function createMixer() {
  let channels: Record<string, Channel> = {};
  let groupsMix: Record<string, Channel> = {};
  let master = 0.75;
  const buses = createBuses();
  let topology: Topology = { ids: [], parentOf: new Map() };

  const sync = () => buses.sync(topology, channels, groupsMix, master);

  const setChannel = (
    store: Record<string, Channel>,
    id: string,
    patch: Partial<Channel>,
  ): Record<string, Channel> => {
    const current = store[id] ?? { volume: DEFAULT_VOLUME, muted: false };
    return { ...store, [id]: { ...current, ...patch } };
  };

  return {
    snapshot() {
      return {
        channels: structuredClone(channels),
        groupsMix: structuredClone(groupsMix),
        master,
      };
    },
    /** 恢复存档中的整套混音（含编组层级），并按给定拓扑接线 */
    restore(
      nextChannels: Record<string, Channel>,
      nextGroupsMix: Record<string, Channel>,
      volume: number,
      nextTopology: Topology,
    ) {
      channels = structuredClone(nextChannels);
      groupsMix = structuredClone(nextGroupsMix);
      master = level(volume);
      topology = nextTopology;
      sync();
    },
    /** 结构变化后更新拓扑；缺失的声道补默认值，已删除的声道一并清掉 */
    setTopology(next: Topology, kindOf: (id: string) => "track" | "group") {
      topology = next;
      const keepTracks = next.ids.filter(
        (id) => kindOf(id) === "track" && channels[id],
      );
      const keepGroups = next.ids.filter(
        (id) => kindOf(id) === "group" && groupsMix[id],
      );
      channels = Object.fromEntries(keepTracks.map((id) => [id, channels[id]]));
      groupsMix = Object.fromEntries(
        keepGroups.map((id) => [id, groupsMix[id]]),
      );
      for (const id of next.ids) {
        if (kindOf(id) === "track" && !channels[id])
          channels[id] = { volume: DEFAULT_VOLUME, muted: false };
        if (kindOf(id) === "group" && !groupsMix[id])
          groupsMix[id] = { volume: DEFAULT_VOLUME, muted: false };
      }
      sync();
    },
    volume(id: string, value: number) {
      if (channels[id])
        channels = setChannel(channels, id, { volume: level(value) });
      sync();
    },
    mute(id: string) {
      const state = channels[id];
      if (state) channels = setChannel(channels, id, { muted: !state.muted });
      sync();
    },
    groupVolume(id: string, value: number) {
      if (groupsMix[id])
        groupsMix = setChannel(groupsMix, id, { volume: level(value) });
      sync();
    },
    /** 编组静音只切编组自身增益，子轨推子与静音状态原样保留 */
    groupMute(id: string) {
      const state = groupsMix[id];
      if (state)
        groupsMix = setChannel(groupsMix, id, { muted: !state.muted });
      sync();
    },
    master(value: number) {
      master = level(value);
      sync();
    },
    attach(ctx: AudioContext) {
      buses.attach(ctx);
      sync();
    },
    channel: (id: string) => buses.channel(id),
    dispose: () => buses.dispose(),
  };
}
export type Mixer = ReturnType<typeof createMixer>;
