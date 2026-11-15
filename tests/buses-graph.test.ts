import assert from "node:assert/strict";
import { test } from "node:test";
import { createBuses, type Topology } from "../src/features/mixer/model/buses.ts";
import type { Channel } from "../src/shared/types.ts";

class MockParam {
  value = 1;
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
}

class MockNode {
  gain = new MockParam();
  outputs: MockNode[] = [];
  disconnected = false;
  constructor(public label: string) {}
  connect(node: MockNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.disconnected = true;
    this.outputs = [];
  }
}

class MockContext {
  currentTime = 10;
  nodes: MockNode[] = [];
  destination = new MockNode("destination");
  createGain() {
    const node = new MockNode(`gain#${this.nodes.length}`);
    this.nodes.push(node);
    return node;
  }
}

const topo = (
  ids: string[],
  parentOf: [string, string | null][],
): Topology => ({ ids, parentOf: new Map(parentOf) });
const ch = (volume: number, muted = false): Channel => ({ volume, muted });

const harness = () => {
  const ctx = new MockContext();
  const buses = createBuses();
  buses.attach(ctx as unknown as AudioContext);
  const master = ctx.nodes[0];
  /** 节点 0 是主输出；通道节点按 topology.ids 顺序依次创建 */
  const channelNode = (index: number) => ctx.nodes[index + 1];
  /** 沿未断开的输出做可达性判断 */
  const reaches = (from: MockNode, target: MockNode): boolean => {
    const seen = new Set<MockNode>();
    const walk = (node: MockNode): boolean => {
      if (node === target) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      return node.outputs.some((o) => !o.disconnected && walk(o));
    };
    return walk(from);
  };
  const liveNodes = () => ctx.nodes.filter((n) => !n.disconnected);
  return { ctx, buses, master, channelNode, reaches, liveNodes };
};

test("初始接线：子轨→编组→主输出，增益按各级声道设置", () => {
  const { buses, master, channelNode, reaches } = harness();
  buses.sync(
    topo(
      ["g1", "t1"],
      [
        ["g1", null],
        ["t1", "g1"],
      ],
    ),
    { t1: ch(0.5) },
    { g1: ch(0.8) },
    0.7,
  );
  const g1 = channelNode(0);
  const t1 = channelNode(1);
  assert.equal(master.gain.value, 0.7);
  assert.equal(g1.gain.value, 0.8);
  assert.equal(t1.gain.value, 0.5);
  // 经独立 send 节点连通：g1 可达 master，t1 可达 g1 与 master
  assert.ok(reaches(g1, master));
  assert.ok(reaches(t1, g1));
  assert.ok(reaches(t1, master));
});

test("编组静音只切编组增益，子轨推子数值与增益保持不变", () => {
  const { buses, channelNode } = harness();
  const t = topo(
    ["g1", "t1"],
    [
      ["g1", null],
      ["t1", "g1"],
    ],
  );
  buses.sync(t, { t1: ch(0.55) }, { g1: ch(0.9, false) }, 0.7);
  const g1 = channelNode(0);
  const t1 = channelNode(1);
  buses.sync(t, { t1: ch(0.55) }, { g1: ch(0.9, true) }, 0.7);
  assert.equal(g1.gain.value, 0); // 组静音：组增益为零
  assert.equal(t1.gain.value, 0.55); // 子轨推子没有被改成零
  buses.sync(t, { t1: ch(0.55) }, { g1: ch(0.9, false) }, 0.7);
  assert.equal(g1.gain.value, 0.9); // 解除后恢复原平衡
  assert.equal(t1.gain.value, 0.55);
});

test("播放中改接：通道节点身份不变，新旧两条发送在交叉淡变窗口内并存", () => {
  const { buses, channelNode, reaches, liveNodes } = harness();
  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g1"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  const g1 = channelNode(0);
  const g2 = channelNode(1);
  const t1 = channelNode(2);
  const t1Before = t1;
  const countBefore = liveNodes().length;

  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g2"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  // 通道增益节点是同一个对象：已发声/按住的声部连接不被打断
  assert.equal(channelNode(2), t1Before);
  // 新增的是淡入用 send，旧 send 仍在淡出（还未被定时器清理）
  assert.equal(liveNodes().length, countBefore + 1);
  // 此刻 t1 同时可达旧组 g1 与新组 g2
  assert.ok(reaches(t1, g1));
  assert.ok(reaches(t1, g2));
});

test("删除节点会断开其全部连边，其余节点仍然可用", () => {
  const { buses, channelNode, reaches, master, liveNodes } = harness();
  buses.sync(
    topo(
      ["g1", "t1", "t2"],
      [
        ["g1", null],
        ["t1", "g1"],
        ["t2", null],
      ],
    ),
    { t1: ch(0.5), t2: ch(0.5) },
    { g1: ch(1) },
    1,
  );
  const t2 = channelNode(2);
  const before = liveNodes().length;
  buses.sync(topo(["t2"], [["t2", null]]), { t2: ch(0.5) }, {}, 1);
  assert.ok(liveNodes().length < before);
  // t2 的持久节点身份与增益保持不变，仍连到主输出
  assert.equal(t2.gain.value, 0.5);
  assert.ok(!t2.disconnected);
  assert.ok(reaches(t2, master));
});

test("dispose 断开并清空全部节点", () => {
  const { buses, liveNodes } = harness();
  buses.sync(topo(["t1"], [["t1", null]]), { t1: ch(0.5) }, {}, 1);
  buses.dispose();
  assert.ok(liveNodes().length === 0);
});

test("改接后立即删除源节点，不残留游离发送或孤儿连边", () => {
  const { buses, ctx, reaches, master } = harness();
  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g1"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  // 改接（产生一条淡出中的旧发送），紧接着删除 t1
  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g2"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  buses.sync(topo(["g1", "g2"], [["g1", null], ["g2", null]]), {}, { g1: ch(1), g2: ch(1) }, 1);

  // 没有任何存活节点仍能通向已删除的 t1；两个编组仍正常连主输出
  for (const node of ctx.nodes) {
    if (node.disconnected || node === master) continue;
    assert.ok(!node.label.includes("t1"));
  }
  const g1 = ctx.nodes.find((n) => !n.disconnected && n.gain.value === 1)!;
  assert.ok(reaches(g1, master));
});

test("改接交叉淡变结束后，旧发送被定时器清理，新路径保留", async () => {
  const { buses, channelNode, reaches, ctx } = harness();
  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g1"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  const g1 = channelNode(0);
  const g2 = channelNode(1);
  const t1 = channelNode(2);
  const duringCrossfade = ctx.nodes.filter((n) => !n.disconnected).length;

  buses.sync(
    topo(
      ["g1", "g2", "t1"],
      [
        ["g1", null],
        ["g2", null],
        ["t1", "g2"],
      ],
    ),
    { t1: ch(0.6) },
    { g1: ch(1), g2: ch(1) },
    1,
  );
  assert.ok(reaches(t1, g1) && reaches(t1, g2)); // 淡变窗口内两条路径并存

  // 等待 closeEdge 的 setTimeout（CROSSFADE 60ms + 120ms 缓冲）
  await new Promise((r) => setTimeout(r, 260));
  assert.ok(!reaches(t1, g1)); // 旧路径已断开
  assert.ok(reaches(t1, g2)); // 新路径稳定保留
  assert.ok(ctx.nodes.filter((n) => !n.disconnected).length <= duringCrossfade);
});
