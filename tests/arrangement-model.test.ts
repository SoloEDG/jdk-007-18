import assert from "node:assert/strict";
import { test } from "node:test";
import { createArrangement } from "../src/features/arrangement/model/arrangement.ts";
import { demoSession } from "../src/features/arrangement/lib/demo.ts";
import type { Session } from "../src/shared/types.ts";

const arrange = () => {
  const a = createArrangement();
  const drum = a.add("drums");
  const keys = a.add("keys");
  const g1 = a.addGroup("鼓组");
  const g2 = a.addGroup("子组", g1);
  return { a, drum, keys, g1, g2 };
};

test("轨道移入/移出编组，归属记录正确更新", () => {
  const { a, drum, g1 } = arrange();
  a.moveTrack(drum, g1, false);
  assert.equal(a.snapshot().trackGroups[drum], g1);
  a.moveTrack(drum, null, false);
  assert.equal(a.snapshot().trackGroups[drum], null);
});

test("录音进行中拒绝改归属与改层级，提交目标不会中途变化", () => {
  const { a, drum, g1, g2 } = arrange();
  assert.throws(() => a.moveTrack(drum, g1, true), /录音/);
  assert.throws(() => a.reparentGroup(g2, null, true), /录音/);
  assert.throws(() => a.removeGroup(g1, true, true), /录音/);
  // 拒绝后状态不变
  assert.equal(a.snapshot().trackGroups[drum], null);
  assert.equal(a.snapshot().groups.find((x) => x.id === g2)!.parentId, g1);
});

test("禁止把编组拖进自身或后代", () => {
  const { a, g1, g2 } = arrange();
  assert.throws(() => a.reparentGroup(g1, g1, false));
  assert.throws(() => a.reparentGroup(g1, g2, false));
  // 合法移动允许
  a.reparentGroup(g2, null, false);
  assert.equal(a.snapshot().groups.find((x) => x.id === g2)!.parentId, null);
});

test("解散编组：子轨与子编组提升一层，子轨设置保留", () => {
  const { a, drum, g1, g2 } = arrange();
  a.moveTrack(drum, g1, false);
  a.removeGroup(g1, true, false);
  const snap = a.snapshot();
  // 编组已删除，子编组 g2 提升到根
  assert.equal(snap.groups.find((x) => x.id === g1), undefined);
  assert.equal(snap.groups.find((x) => x.id === g2)!.parentId, null);
  // 轨道仍在，归属提升为根（null）
  assert.ok(snap.tracks.some((t) => t.id === drum));
  assert.equal(snap.trackGroups[drum], null);
});

test("删除编组（连带模式）：组内轨道一起删除，组外轨道保留", () => {
  const { a, drum, keys, g1 } = arrange();
  a.moveTrack(drum, g1, false);
  a.removeGroup(g1, false, false);
  const ids = a.snapshot().tracks.map((t) => t.id);
  assert.ok(!ids.includes(drum));
  assert.ok(ids.includes(keys));
  assert.equal(a.snapshot().trackGroups[drum], undefined);
});

test("删除单条轨道清理其归属记录", () => {
  const { a, drum } = arrange();
  a.remove(drum);
  assert.equal(a.snapshot().trackGroups[drum], undefined);
  assert.equal(a.snapshot().tracks.some((t) => t.id === drum), false);
});

test("折叠只改展示标记，播放数据仍包含全部轨道", () => {
  const { a, g1 } = arrange();
  a.toggleCollapse(g1);
  assert.equal(a.snapshot().groups.find((x) => x.id === g1)!.collapsed, true);
  const playback = a.forPlayback();
  assert.equal(playback.length, 2);
});

test("restore 完整恢复层级与归属，缺失父组的数据被安全归一", () => {
  const a = createArrangement();
  const restored = a.restore(demoSession());
  const snap = a.snapshot();
  assert.equal(restored.version, 2);
  assert.equal(snap.groups.length, 2);
  assert.equal(snap.trackGroups.rhythm, "g-rhythm");
  assert.equal(snap.trackGroups.lead, null);

  const broken = {
    ...demoSession(),
    groups: [{ id: "gx", name: "孤儿", parentId: "nope", collapsed: false }],
    trackGroups: { rhythm: "ghost", chords: null, lead: null },
  } as Session;
  const fixed = a.restore(broken);
  assert.equal(fixed.groups[0].parentId, null);
  assert.equal(a.snapshot().trackGroups.rhythm, null);
  assert.ok(fixed.warnings && fixed.warnings.length >= 2);
});

test("选择编组与选择轨道互相独立，录音始终绑定轨道", () => {
  const { a, g1, drum } = arrange();
  a.select(g1, "group");
  assert.equal(a.selectedTrack(), null);
  const sel = a.selected();
  assert.ok(sel && sel.kind === "group");
  a.select(drum, "track");
  assert.equal(a.selectedTrack()!.id, drum);
});
