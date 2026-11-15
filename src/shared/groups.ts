import type { Group } from "./types";
export type Route = {
  groups: Group[];
  /** 从子轨向上的有序编组 id，最近一级在前 */
  path: string[];
};
/** 以 id 建索引，缺失的父引用按根层级处理，保证读取脏数据时也能渲染 */
export function indexGroups(groups: readonly Group[]) {
  const map = new Map<string, Group>();
  for (const g of groups) map.set(g.id, g);
  return map;
}
/**
 * 计算某条轨道（或某个节点）向上经过的编组合集。
 * 用访问集合拦截环引用；遇到未知父级时在当前位置停止。
 */
export function routeFrom(
  startParent: string | null,
  map: ReadonlyMap<string, Group>,
): Route {
  const chain: Group[] = [];
  const seen = new Set<string>();
  let parentId = startParent;
  while (parentId) {
    if (seen.has(parentId)) break; // 环引用保护
    const group = map.get(parentId);
    if (!group) break; // 父组缺失：止于此处
    seen.add(group.id);
    chain.push(group);
    parentId = group.parentId;
  }
  return { groups: chain, path: chain.map((g) => g.id) };
}
/** nodeId 是否为 ancestorId 的后代（不含自身） */
export function isDescendant(
  ancestorId: string,
  nodeId: string,
  map: ReadonlyMap<string, Group>,
): boolean {
  let cursor = map.get(nodeId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = map.get(cursor)?.parentId ?? null;
  }
  return false;
}
/**
 * 拖放合法性：禁止把编组拖进它自己或它的后代，
 * 也禁止把不存在的节点互相挂接。
 */
export function canReparent(
  groupId: string,
  nextParentId: string | null,
  map: ReadonlyMap<string, Group>,
): boolean {
  if (!map.has(groupId)) return false;
  if (nextParentId === groupId) return false;
  if (nextParentId !== null && !map.has(nextParentId)) return false;
  // 目标父级若位于被拖编组的子树中，挂接后会成环
  if (nextParentId && isDescendant(groupId, nextParentId, map)) return false;
  return true;
}/** 深度优先的展示顺序：父编组紧跟其子树 */
export function orderedGroups(groups: readonly Group[]): Group[] {
  const map = indexGroups(groups);
  const childrenOf = new Map<string | null, Group[]>();
  for (const g of groups) {
    const key = map.has(g.parentId ?? "") ? g.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(g);
    childrenOf.set(key, list);
  }
  const out: Group[] = [];
  const walk = (parent: string | null) => {
    for (const child of childrenOf.get(parent) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(null);
  return out;
}
/** 一个编组（含后代）下的全部编组 id */
export function subtreeIds(
  groupId: string,
  map: ReadonlyMap<string, Group>,
): string[] {
  const ids = [groupId];
  for (let i = 0; i < ids.length; i++) {
    const current = ids[i];
    for (const g of map.values())
      if (g.parentId === current && !ids.includes(g.id)) ids.push(g.id);
  }
  return ids;
}
/** 节点的层级深度，根层级为 0 */
export function depthOf(
  id: string,
  map: ReadonlyMap<string, Group>,
): number {
  let depth = 0;
  let cursor = map.get(id)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth++;
    cursor = map.get(cursor)?.parentId ?? null;
  }
  return depth;
}
