import assert from "node:assert/strict";
import { test } from "node:test";
import {
  indexGroups,
  routeFrom,
  isDescendant,
  canReparent,
  orderedGroups,
  subtreeIds,
  depthOf,
} from "../src/shared/groups.ts";
import { validateSession } from "../src/features/arrangement/lib/validation.ts";
import { buildTopology } from "../src/features/mixer/lib/topology.ts";
import type { Group, Session, LegacySession } from "../src/shared/types.ts";

const g = (id: string, parentId: string | null, collapsed = false): Group => ({
  id,
  name: id,
  parentId,
  collapsed,
});

test("routeFrom 按由近及远返回祖先链并拦截环引用", () => {
  const map = indexGroups([g("a", null), g("b", "a"), g("c", "b")]);
  assert.deepEqual(routeFrom("c", map).path, ["c", "b", "a"]);
  assert.deepEqual(routeFrom(null, map).path, []);
  const cyclic = indexGroups([g("x", "y"), g("y", "x")]);
  const route = routeFrom("x", cyclic);
  assert.ok(route.path.length <= 2);
  assert.ok(!route.path.includes(undefined));
});

test("isDescendant 正确判定后代关系", () => {
  const map = indexGroups([g("a", null), g("b", "a"), g("c", "b")]);
  assert.equal(isDescendant("a", "c", map), true);
  assert.equal(isDescendant("a", "b", map), true);
  assert.equal(isDescendant("b", "a", map), false);
  assert.equal(isDescendant("a", "a", map), false);
});

test("canReparent 拒绝拖入自身或后代，允许合法移动", () => {
  const map = indexGroups([g("a", null), g("b", "a"), g("c", null)]);
  assert.equal(canReparent("a", "a", map), false);
  assert.equal(canReparent("a", "b", map), false);
  assert.equal(canReparent("b", "c", map), true);
  assert.equal(canReparent("b", null, map), true);
  assert.equal(canReparent("missing", null, map), false);
  assert.equal(canReparent("c", "ghost", map), false);
});

test("orderedGroups 父编组先于子树，depthOf 计算层级", () => {
  const map = indexGroups([
    g("root", null),
    g("child", "root"),
    g("other", null),
    g("grand", "child"),
  ]);
  const order = orderedGroups([...map.values()]).map((x) => x.id);
  assert.ok(order.indexOf("root") < order.indexOf("child"));
  assert.ok(order.indexOf("child") < order.indexOf("grand"));
  assert.equal(depthOf("grand", map), 2);
  assert.equal(depthOf("root", map), 0);
  assert.deepEqual(subtreeIds("root", map), ["root", "child", "grand"]);
});

const v1 = (): LegacySession => ({
  version: 1,
  title: "old",
  bpm: 100,
  beats: 8,
  master: 0.5,
  channels: { t1: { volume: 0.4, muted: true } },
  tracks: [
    {
      id: "t1",
      name: "鼓",
      instrument: "drums",
      color: "#ffffff",
      notes: [],
    },
  ],
});

test("v1 存档迁移为结构完整的 v2", () => {
  const s = validateSession(v1());
  assert.equal(s.version, 2);
  assert.deepEqual(s.groups, []);
  assert.deepEqual(s.trackGroups, { t1: null });
  assert.equal(s.channels.t1.volume, 0.4);
  assert.deepEqual(s.groupsMix, {});
});

test("缺失父组与环引用被安全提升并产生 warnings，不覆盖数据", () => {
  const base = v1();
  const raw = {
    ...base,
    version: 2,
    groups: [
      { id: "g1", name: "G1", parentId: "ghost", collapsed: false },
      { id: "g2", name: "G2", parentId: "g3", collapsed: false },
      { id: "g3", name: "G3", parentId: "g2", collapsed: false },
    ],
    groupsMix: { g1: { volume: 0.9, muted: false } },
    trackGroups: { t1: "missing-group" },
  } as unknown as Session;
  const s = validateSession(raw);
  assert.equal(s.groups.find((x) => x.id === "g1")!.parentId, null);
  assert.ok(s.warnings && s.warnings.length >= 2);
  assert.equal(s.trackGroups.t1, null);
  // 损坏的 groupsMix 回退默认值
  assert.ok(s.groupsMix.g2);
  assert.equal(s.groupsMix.g1.volume, 0.9);
});

test("致命错误抛异常而不是返回半套数据", () => {
  assert.throws(() => validateSession({ ...v1(), version: 9 }));
  assert.throws(() => validateSession({ ...v1(), bpm: 9999 }));
  const broken = { ...v1(), version: 2, groups: [] } as unknown as Session;
  assert.throws(() =>
    validateSession({ ...broken, channels: { t1: { volume: 2 } } }),
  );
});

test("buildTopology 反映父子关系，父缺失时回退主输出", () => {
  const groups = [g("a", null), g("b", "a")];
  const topo = buildTopology(
    groups,
    { t1: "b", t2: "ghost", t3: null },
    ["t1", "t2", "t3"],
  );
  assert.equal(topo.parentOf.get("b"), "a");
  assert.equal(topo.parentOf.get("t1"), "b");
  assert.equal(topo.parentOf.get("t2"), null);
  assert.equal(topo.parentOf.get("t3"), null);
  assert.ok(topo.ids.includes("a") && topo.ids.includes("t1"));
});
