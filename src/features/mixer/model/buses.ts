import type { Channel } from "@/shared/types";

const MASTER = "\u0001master";
const edgeKey = (from: string, to: string) => `${from}\u001f${to}`;
/** 改接时新旧路径交叉淡变时长（秒），保证播放中听不到断点 */
const CROSSFADE = 0.06;
/** 增益缓动时间常数，推子/静音变化不产生 zipper 噪声 */
const RAMP = 0.02;

export type Topology = {
  /** 当前全部节点 id（轨道 + 编组） */
  ids: string[];
  /** 每个节点的上一级父节点，null 表示直连主输出 */
  parentOf: Map<string, string | null>;
};

export function createBuses() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const nodes = new Map<string, GainNode>();
  const parents = new Map<string, string | null>();
  /** 每条连边一个独立发送增益，改接时可对单条边淡入淡出 */
  const sends = new Map<string, GainNode>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const targetOf = (to: string): GainNode | null =>
    to === MASTER ? master : (nodes.get(to) ?? null);

  const clearTimer = (key: string) => {
    const timer = pending.get(key);
    if (timer) {
      clearTimeout(timer);
      pending.delete(key);
    }
  };

  const ramp = (node: AudioParam, value: number, immediate = false) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    node.cancelScheduledValues(t);
    node.setValueAtTime(node.value, t);
    node.setTargetAtTime(value, t, immediate ? 0.001 : RAMP);
  };

  const openEdge = (from: string, to: string, immediate: boolean) => {
    if (!ctx) return;
    const key = edgeKey(from, to);
    let send = sends.get(key);
    if (send) {
      // 可能正处于淡出收尾，撤销它并恢复满电平
      clearTimer(key);
      ramp(send.gain, 1, immediate);
      return;
    }
    const source = nodes.get(from);
    const target = targetOf(to);
    if (!source || !target) return;
    send = ctx.createGain();
    source.connect(send);
    send.connect(target);
    send.gain.setValueAtTime(immediate ? 1 : 0.0001, ctx.currentTime);
    sends.set(key, send);
    if (!immediate) ramp(send.gain, 1);
  };

  const closeEdge = (from: string, to: string) => {
    const key = edgeKey(from, to);
    const send = sends.get(key);
    if (!send || !ctx) return;
    clearTimer(key);
    ramp(send.gain, 0);
    const timer = setTimeout(() => {
      send.disconnect();
      sends.delete(key);
      pending.delete(key);
    }, CROSSFADE * 1000 + 120);
    pending.set(key, timer);
  };

  /** 立即断开一条边（用于新音频上下文或节点删除） */
  const closeEdgeNow = (from: string, to: string) => {
    const key = edgeKey(from, to);
    const send = sends.get(key);
    if (!send) return;
    clearTimer(key);
    send.disconnect();
    sends.delete(key);
  };

  /**
   * 播放中把节点改接到新父级：旧路径淡出、新路径淡入，
   * 两条路径短暂重叠。已经发声和现场按住的声音都接在节点本身上，
   * 因此自动跟随新路径，无需重连任何声部。
   */
  const reroute = (
    from: string,
    oldParent: string | null,
    nextParent: string | null,
    immediate: boolean,
  ) => {
    if (oldParent === nextParent) return;
    const toOld = oldParent ?? MASTER;
    const toNew = nextParent ?? MASTER;
    if (immediate) {
      closeEdgeNow(from, toOld);
      openEdge(from, toNew, true);
    } else {
      // 先开新路径再关旧路径，重叠交叉淡变避免瞬间掉声
      openEdge(from, toNew, false);
      closeEdge(from, toOld);
    }
  };

  const gainFor = (state: Channel | undefined): number =>
    state ? (state.muted ? 0 : state.volume) : 1;

  return {
    attach(context: AudioContext) {
      if (ctx === context) return;
      this.dispose();
      ctx = context;
      master = context.createGain();
      master.connect(context.destination);
    },
    /**
     * 按目标拓扑与各级声道状态对账：
     * 节点持久存在（声部直连不被打断），只增删连边并平滑更新增益。
     */
    sync(
      topology: Topology,
      trackStates: Readonly<Record<string, Channel>>,
      groupStates: Readonly<Record<string, Channel>>,
      masterVolume: number,
    ) {
      if (!ctx || !master) return;
      const live = new Set(topology.ids);
      const created = new Set<string>();

      // 1. 移除已删除节点及其全部连边
      for (const id of [...nodes.keys()]) {
        if (live.has(id)) continue;
        // 该节点作为连边起点（出边）
        const outgoing = parents.get(id);
        if (outgoing !== undefined)
          closeEdgeNow(id, outgoing ?? MASTER);
        // 该节点作为连边终点（其它节点的入边）
        for (const [otherId, parent] of parents)
          if (parent === id) closeEdgeNow(otherId, id);
        // 兜底：断开可能仍在淡出收尾的游离发送，避免残留声音路径
        nodes.get(id)?.disconnect();
        nodes.delete(id);
        parents.delete(id);
      }

      // 2. 新建缺失节点（尚未连接，先不带声音）
      for (const id of topology.ids) {
        if (!nodes.has(id)) {
          nodes.set(id, ctx.createGain());
          created.add(id);
        }
      }

      // 3. 对账连边：新建节点直连满电平，其余改接走交叉淡变
      for (const id of topology.ids) {
        const desired = topology.parentOf.get(id) ?? null;
        const current = parents.has(id) ? parents.get(id)! : undefined;
        if (current === undefined) {
          openEdge(id, desired ?? MASTER, true);
        } else if (current !== desired) {
          reroute(id, current, desired, false);
        }
        parents.set(id, desired);
      }

      // 4. 平滑应用各级增益。静音只改本节点增益，子轨推子数值不动
      for (const id of topology.ids) {
        const node = nodes.get(id)!;
        const state = trackStates[id] ?? groupStates[id];
        ramp(node.gain, gainFor(state), created.has(id));
      }
      ramp(master.gain, masterVolume);
    },
    /** 声部（合成器）的接入点：轨道自身的持久增益节点 */
    channel(id: string) {
      const bus = nodes.get(id);
      if (!bus) throw new Error("声道未初始化");
      return bus;
    },
    dispose() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      for (const send of sends.values()) send.disconnect();
      sends.clear();
      for (const node of nodes.values()) node.disconnect();
      nodes.clear();
      parents.clear();
      master?.disconnect();
      master = null;
      ctx = null;
    },
  };
}
