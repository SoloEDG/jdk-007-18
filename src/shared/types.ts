export type Instrument = "drums" | "keys";
export type Note = {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  velocity: number;
};
export type Track = {
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  notes: Note[];
};
export type Channel = { volume: number; muted: boolean };
/**
 * 轨道编组：通过 parentId 组成树（null 表示根层级）。
 * 编组同时拥有自己的混音声道，声音链路为
 * 子轨增益 → 各级父编组增益 → 主输出。
 */
export type Group = {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
};
export type Session = {
  version: 2;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  groups: Group[];
  /** 每条轨道所属编组，null 表示直接挂在主输出上 */
  trackGroups: Record<string, string | null>;
  /** 子轨混音，键为轨道 id */
  channels: Record<string, Channel>;
  /** 各级编组混音，键为编组 id */
  groupsMix: Record<string, Channel>;
  master: number;
};
/** 旧版（v1）存档结构，仅用于读取时迁移 */
export type LegacySession = {
  version: 1;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  channels: Record<string, Channel>;
  master: number;
};
export type NoteInput = {
  pitch: number;
  velocity: number;
  instrument: Instrument;
};
export type ScheduledNote = NoteInput & {
  duration: number;
  when: number;
  trackId: string;
};
export type Listener = () => void;
