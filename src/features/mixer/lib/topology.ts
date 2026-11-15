import type { Group } from "@/shared/types";
import { indexGroups } from "@/shared/groups";
import type { Topology } from "../model/buses";

/**
 * 由编组树与轨道归属构建音频节点拓扑：
 * 每个编组与每条轨道都是一个持久增益节点，
 * 父级缺失时该节点安全回退到主输出。
 */
export function buildTopology(
  groups: readonly Group[],
  trackGroups: Readonly<Record<string, string | null>>,
  trackIds: readonly string[],
): Topology {
  const map = indexGroups(groups);
  const parentOf = new Map<string, string | null>();
  for (const group of groups)
    parentOf.set(
      group.id,
      group.parentId && map.has(group.parentId) ? group.parentId : null,
    );
  for (const id of trackIds) {
    const owner = trackGroups[id] ?? null;
    parentOf.set(id, owner && map.has(owner) ? owner : null);
  }
  return { ids: [...groups.map((g) => g.id), ...trackIds], parentOf };
}
