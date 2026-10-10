export { Dock, type DockProps, type DockTool, type DockViewport } from "./dock";
export type { DockEdge, DockPosition } from "./dock-math";
export { COLLAPSED_KEY, DOCK_KEY } from "./dock-storage";
export {
  DockedToaster,
  getDockPlacement,
  subbarPosition,
  subscribeDockPlacement,
  useDockPlacement,
  type DockMode,
  type DockPlacement,
  type DockRect,
} from "./placement";
