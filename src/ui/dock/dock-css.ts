/**
 * Dock styles, copied from design/prototype.html (the `.dock` block). They ship with the dock and are
 * rendered as a <style> inside the shadow root next to it, so the shared UI stylesheet stays T02's.
 * Everything is under `.pp .dock` (higher specificity than the primitives' `.pp .ib`, `.pp .seg`).
 *
 * Differences from the prototype, all deliberate:
 *  - tooltips are the T02 <Tooltip> (placed from the dock's placement), so the `.tip` rules are gone;
 *  - the settle after a drag is the in-house spring, so `.settling` (the CSS left/top transition) is gone.
 */
export const DOCK_CSS = /* css */ `
.pp .dock{position:fixed;left:50%;bottom:20px;translate:-50% 0;z-index:60;display:flex;align-items:center;gap:2px;padding:5px;border-radius:16px;background:var(--mat-1);backdrop-filter:var(--blur-1);-webkit-backdrop-filter:var(--blur-1);box-shadow:var(--sh-2),var(--edge);touch-action:none;user-select:none;-webkit-user-select:none}
.pp .dock.free{translate:none;bottom:auto}
.pp .dock.dragging{box-shadow:var(--sh-3),var(--edge);cursor:grabbing}
.pp .dock.intro{animation:pp-dock-in .45s var(--ease) both}
@keyframes pp-dock-in{from{opacity:0;translate:-50% 12px;scale:.97}}
.pp .dock .tw{display:grid;grid-template-columns:1fr;transition:grid-template-columns .32s var(--ease-drawer),opacity .2s var(--ease)}
.pp .dock .tw-in{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}
.pp .dock.v .tw{grid-template-columns:none;grid-template-rows:1fr;transition:grid-template-rows .32s var(--ease-drawer),opacity .2s var(--ease)}
.pp .dock.v .tw-in{flex-direction:column;min-height:0}
.pp .dock.col .tw{grid-template-columns:0fr;opacity:0}
.pp .dock.v.col .tw{grid-template-rows:0fr}
.pp .dock.col .tw-in{visibility:hidden;transition:visibility 0s .32s}
.pp .dock .nm-w{display:grid;grid-template-columns:1fr;transition:grid-template-columns .32s var(--ease-drawer),opacity .2s var(--ease)}
.pp .dock .nm-w .nm{overflow:hidden;white-space:nowrap;min-width:0}
.pp .dock.col .nm-w{grid-template-columns:0fr;opacity:0}
.pp .dock.col .brand{gap:0;padding:0 4px}
.pp .dock .brand{position:relative;display:flex;align-items:center;gap:8px;height:30px;padding:0 10px 0 4px;border-radius:10px;font:600 13px/1 var(--sans);letter-spacing:-.01em;color:var(--fg);cursor:grab;transition:background-color .12s var(--ease),gap .32s var(--ease-drawer),padding .32s var(--ease-drawer)}
@media (hover:hover){.pp .dock .brand:hover{background:var(--fill-2)}}
.pp .dock .brand:active .logo{scale:.92}
.pp .dock .logo{width:20px;height:20px;border-radius:6px;background:linear-gradient(180deg,#ff7a7a,#ff5050);color:#fff;display:grid;place-items:center;flex:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 1px 2px rgba(0,0,0,.4);transition:scale .12s var(--ease)}
.pp .dock .logo .ic{width:12px;height:12px;stroke-width:2.4}
.pp .dock .lbadge{min-width:16px;height:16px;padding:0 4px;margin-left:6px;border-radius:8px;background:var(--fill-3);color:var(--fg);font:600 10px/16px var(--sans);text-align:center}
.pp .dock .lbadge[hidden]{display:none}
.pp .dock .sep{width:1px;height:20px;background:var(--line-2);margin:0 4px;flex:none}
.pp .dock .grip{all:unset;cursor:grab;width:16px;height:30px;display:grid;place-items:center;color:var(--fg-3);border-radius:6px;transition:color .12s var(--ease)}
.pp.pp .dock .grip:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
@media (hover:hover){.pp .dock .grip:hover{color:var(--fg-2)}}
.pp .dock.dragging .grip{cursor:grabbing}
.pp .dock.v{flex-direction:column;padding:5px}
.pp .dock.v .sep{width:20px;height:1px;margin:4px 0}
.pp .dock.v .seg{flex-direction:column}
.pp .dock.v .nm-w{display:none}
.pp .dock.v .brand{height:30px;padding:0;width:30px;justify-content:center}
.pp .dock.v .lbadge{position:absolute;top:-4px;right:-6px;margin:0;min-width:16px;height:16px;padding:0 4px;background:var(--acc-solid);color:var(--acc-fg);font-size:9.5px;line-height:16px;box-shadow:0 0 0 2px #1d1d21}
.pp .dock.v .grip{width:30px;height:16px}
.pp .dock.v .grip svg{rotate:90deg}
@media (max-width:760px){
  .pp .dock:not(.free){left:12px;right:12px;translate:none;flex-wrap:wrap;justify-content:center}
}
`;
