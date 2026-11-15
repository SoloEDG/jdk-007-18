import assert from "node:assert/strict";
import { test, before } from "node:test";

// ---- 最小浏览器环境 shim：studio 仅在解锁声音时才碰 AudioContext ----
const store = new Map<string, string>();
before(() => {
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  } as unknown as Window & typeof globalThis;
});

const { createStudio } = await import("../src/app/studio.ts");
const STORAGE_KEY = "nightshift-session-v1";

test("编组静音只改组增益，子轨推子数值保持不变", () => {
  const s = createStudio(() => {});
  s.add("drums");
  const trackId = s.view().arrangement.tracks[0].id;
  s.addGroup("鼓组");
  const groupId = s.view().arrangement.groups[0].id;
  s.volume(trackId, 0.42);
  s.moveTrack(trackId, groupId);

  s.groupMute(groupId);
  const muted = s.view().mixer;
  assert.equal(muted.groupsMix[groupId].muted, true);
  assert.equal(muted.channels[trackId].volume, 0.42); // 子轨推子没被改成零
  assert.equal(muted.channels[trackId].muted, false);

  s.groupMute(groupId);
  const restored = s.view().mixer;
  assert.equal(restored.groupsMix[groupId].muted, false);
  assert.equal(restored.channels[trackId].volume, 0.42); // 解除后原平衡恢复
  s.dispose();
});

test("保存/恢复往返保留层级与各级混音", () => {
  const s = createStudio(() => {});
  s.add("keys");
  const t1 = s.view().arrangement.tracks[0].id;
  s.addGroup("和声");
  const g1 = s.view().arrangement.groups[0].id;
  s.moveTrack(t1, g1);
  s.groupVolume(g1, 0.33);
  s.save();

  const s2 = createStudio(() => {});
  s2.add("drums"); // 先制造不同的当前作品
  s2.load();
  const v = s2.view();
  assert.equal(v.arrangement.groups[0].id, g1);
  assert.equal(v.arrangement.trackGroups[t1], g1);
  assert.equal(v.mixer.groupsMix[g1].volume, 0.33);
  assert.equal(v.mixer.channels[t1].volume, 0.75);
  s2.dispose();
  s.dispose();
});

test("损坏存档抛错时当前作品不被半套覆盖", () => {
  const s = createStudio(() => {});
  s.add("drums");
  const before = s.view().arrangement.tracks.length;
  store.set(STORAGE_KEY, "{不是合法 JSON");
  s.load();
  assert.match(s.view().message, /作品已保留|格式|JSON|存档/);
  assert.equal(s.view().arrangement.tracks.length, before);

  store.set(
    STORAGE_KEY,
    JSON.stringify({ version: 2, title: "x", bpm: 9999, beats: 16, tracks: [], groups: [], channels: {}, groupsMix: {}, master: 1 }),
  );
  s.load();
  assert.equal(s.view().arrangement.tracks.length, before); // 校验失败，未覆盖
  s.dispose();
});

test("拖入后代的非法编组移动被拒绝且结构不变", () => {
  const s = createStudio(() => {});
  s.addGroup("父");
  s.addGroup("子");
  const groups = () => s.view().arrangement.groups;
  const parent = groups().find((g) => g.name === "父")!.id;
  const realChild = groups().find((g) => g.name === "子")!.id;
  // 先建立真正的父子关系：子 挂到 父 下
  s.reparentGroup(realChild, parent);
  assert.equal(groups().find((g) => g.id === realChild)!.parentId, parent);
  // 再把 父 拖进它自己的后代 子 → 必须拒绝
  s.reparentGroup(parent, realChild);
  assert.equal(groups().find((g) => g.id === parent)!.parentId, null);
  assert.equal(groups().find((g) => g.id === realChild)!.parentId, parent);
  assert.match(s.view().message, /自己或它的子编组/);
  // 拖入自身也拒绝
  s.reparentGroup(parent, parent);
  assert.equal(groups().find((g) => g.id === parent)!.parentId, null);
  s.dispose();
});
