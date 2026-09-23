import type { PatchStore } from '../../core/store';
import type { EngineView } from '../../audio/engineApi';
import type { PortKind } from '../../core/types';

export interface JackInfo {
  key: string;
  moduleId: string;
  portId: string;
  dir: 'in' | 'out';
  kind: PortKind;
  el: HTMLElement;
  ledEl?: HTMLElement;
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export function jackKey(moduleId: string, portId: string, dir: 'in' | 'out'): string {
  return `${moduleId}:${portId}:${dir}`;
}

/** Shared services module cards, cables and the palette need from the canvas controller. */
export interface Ctx {
  store: PatchStore;
  engine: EngineView;
  root: HTMLElement;
  world: HTMLElement;
  view: ViewState;
  jacks: Map<string, JackInfo>;
  jackGeometry: Map<string, { x: number; y: number }>;
  registerJack(info: JackInfo): void;
  unregisterJack(key: string): void;
  recalcJackGeometry(moduleId: string): void;
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  openPalette(worldX: number, worldY: number): void;
  onJackPointerDown(info: JackInfo, e: PointerEvent): void;
  onJackClick(info: JackInfo): void;
}
