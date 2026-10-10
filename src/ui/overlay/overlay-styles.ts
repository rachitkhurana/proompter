/**
 * CSS for the pick overlay: hover box and label, selection boxes, the multi bar, the box-select catcher and pins.
 * Every number is copied from design/prototype.html (`/* overlay: hover, selection, pins *\/`, `.subbar`).
 * Classes are prefixed `pm-` so they can't collide with the kit's other CSS. Tokens (`--acc`, `--ease`, ...) come
 * from `.pp` (src/ui/styles.css), so render inside the shadow root.
 *
 * T04 doesn't own styles.css, so this ships as a string rendered by `<OverlayStyles />`. Merge it into styles.css
 * if you'd rather have one stylesheet.
 */
export const overlayCss = /* css */ `
.pp .pm-ovl{position:fixed;inset:0;pointer-events:none;z-index:40}
.pp .pm-hov{position:fixed;border-radius:6px;box-shadow:0 0 0 1.5px var(--acc),0 0 0 4px var(--acc-soft);background:rgba(255,99,99,.06);opacity:0;transition:opacity .12s var(--ease),left .09s var(--ease),top .09s var(--ease),width .09s var(--ease),height .09s var(--ease)}
.pp .pm-hov.on{opacity:1}
.pp .pm-hlab{position:fixed;display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;background:var(--acc-solid);color:var(--acc-fg);font:500 11.5px/16px var(--sans);white-space:nowrap;opacity:0;translate:0 2px;transition:opacity .12s var(--ease),translate .15s var(--ease)}
.pp .pm-hlab.on{opacity:1;translate:0 0}
.pp .pm-hlab .mono{font-size:10.5px;opacity:.8}
.pp .pm-selb{position:fixed;border-radius:6px;box-shadow:0 0 0 1.5px var(--acc);background:var(--acc-soft)}
.pp .pm-selb b{position:absolute;top:-8px;left:-8px;width:18px;height:18px;border-radius:50%;background:var(--acc-solid);color:var(--acc-fg);font:600 10px/18px var(--sans);text-align:center;box-shadow:0 0 0 2px var(--canvas)}
.pp .pm-catch{position:fixed;z-index:45;cursor:crosshair;pointer-events:auto;touch-action:none}
.pp .pm-drag{position:fixed;z-index:46;border-radius:4px;box-shadow:0 0 0 1.5px var(--acc);background:var(--acc-soft);pointer-events:none}

.pp .pm-subbar{position:fixed;z-index:61;display:flex;align-items:center;gap:8px;height:42px;padding:0 6px 0 14px;border-radius:14px;background:var(--mat-1);backdrop-filter:var(--blur-1);-webkit-backdrop-filter:var(--blur-1);box-shadow:var(--sh-2),var(--edge);font:500 12.5px/1 var(--sans);transition:opacity .16s var(--ease),scale .16s var(--ease)}
.pp .pm-subbar:not(.on){opacity:0;scale:.96;pointer-events:none}

.pp .pm-pin{position:fixed;pointer-events:auto;width:24px;height:24px;margin:-12px 0 0 -12px;padding:0;border:0;border-radius:12px 12px 12px 3px;display:grid;place-items:center;color:#fff;font:600 10.5px/1 var(--sans);cursor:pointer;box-shadow:0 0 0 2px rgba(9,9,11,.9),0 6px 14px -2px rgba(0,0,0,.55);transition:scale .16s var(--ease)}
.pp .pm-pin.fresh{animation:pm-pin-in .32s var(--ease) both}
.pp .pm-pin:active{scale:.94}
.pp .pm-pin.blocking{background:var(--p-blocking)}
.pp .pm-pin.important{background:#d4891a}
.pp .pm-pin.minor{background:#52525b}
.pp .pm-pin.done{background:#27272a;color:var(--fg-3)}
.pp .pm-pin-ring{position:absolute;inset:-2px;border-radius:inherit;box-shadow:0 0 0 0 var(--acc-line);animation:pm-ring .9s var(--ease) 2;pointer-events:none}
.pp .pm-pin-card{position:absolute;left:18px;top:-6px;width:248px;padding:10px 12px;border-radius:12px;background:var(--mat-1);backdrop-filter:var(--blur-1);-webkit-backdrop-filter:var(--blur-1);box-shadow:var(--sh-2),var(--edge);text-align:left;color:var(--fg);opacity:0;scale:.96;transform-origin:0 12px;transition:opacity .14s var(--ease),scale .18s var(--ease);pointer-events:none}
.pp .pm-pin-card b{display:block;font:500 13px/18px var(--sans)}
.pp .pm-pin-card > span{display:flex;gap:6px;align-items:center;margin-top:4px;font:400 11.5px/16px var(--sans);color:var(--fg-3)}
.pp .pm-pin-card i.dot{display:block;width:3px;height:3px;border-radius:50%;background:var(--fg-4)}
@media (hover:hover){.pp .pm-pin:hover .pm-pin-card{opacity:1;scale:1}}
.pp .pm-pin:focus-visible .pm-pin-card{opacity:1;scale:1}
@keyframes pm-pin-in{from{opacity:0;scale:.6}to{opacity:1;scale:1}}
@keyframes pm-ring{to{box-shadow:0 0 0 12px transparent}}
`;
