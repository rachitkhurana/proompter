/**
 * CSS for the composer. Every number is copied from design/prototype.html (`/* surfaces *\/` and
 * `/* composer *\/`). Classes are prefixed `pm-` (see overlay-styles.ts for why this isn't in styles.css); tokens
 * come from `.pp`. Rendered by `<Composer>` itself, so there is nothing to mount separately.
 *
 * Deviations from the prototype, all small: `--p-urgent` is `--p-blocking` (D2.5); the open animation uses
 * `@starting-style` instead of a class added a frame later; `.pm-ctx` can scroll if a very long log would push the
 * panel past `max-height`.
 */
export const composerCss = /* css */ `
.pp .pm-comp{position:fixed;z-index:90;width:min(500px,calc(100vw - 24px));display:flex;flex-direction:column;max-height:calc(100vh - 24px);background:var(--mat-2);backdrop-filter:var(--blur-2);-webkit-backdrop-filter:var(--blur-2);box-shadow:var(--sh-3),var(--edge);border-radius:16px;opacity:0;scale:.96;transition:opacity .16s var(--ease),scale .2s var(--ease);pointer-events:none}
.pp .pm-comp.on{opacity:1;scale:1;pointer-events:auto}
@starting-style{.pp .pm-comp.on{opacity:0;scale:.96}}
.pp .pm-comp-hd{display:flex;align-items:center;gap:8px;padding:12px 12px 0 16px;flex:none}
.pp .pm-target{display:flex;align-items:center;gap:8px;min-width:0;flex:1;font:500 12px/16px var(--sans);color:var(--fg-2)}
.pp .pm-ti{width:22px;height:22px;border-radius:6px;background:var(--acc-soft);color:var(--acc);display:grid;place-items:center;flex:none}
.pp .pm-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-comp-bd{padding:12px 16px 4px;display:grid;gap:4px;overflow:auto;min-height:0}
.pp .pm-in-title{all:unset;width:100%;font:600 16px/24px var(--sans);letter-spacing:-.012em;color:var(--fg)}
.pp .pm-in-title::placeholder{color:var(--fg-4)}
.pp .pm-in-desc{all:unset;width:100%;min-height:60px;font:400 13.5px/21px var(--sans);color:var(--fg-2);white-space:pre-wrap}
.pp .pm-in-desc::placeholder{color:var(--fg-4)}
.pp .pm-err{font:400 12px/16px var(--sans);color:var(--p-blocking)}
.pp .pm-quote{margin:2px 0 6px;padding:2px 0 2px 12px;box-shadow:inset 2px 0 0 var(--acc);color:var(--fg-2);font-style:italic;white-space:pre-wrap}
.pp .pm-props{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 14px;flex:none}
.pp .pm-ctx{box-shadow:inset 0 1px 0 var(--line);flex:0 1 auto;min-height:0;overflow:auto}
.pp .pm-ctx summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;height:40px;padding:0 16px;font:400 12px/16px var(--sans);color:var(--fg-3);transition:color .12s var(--ease)}
.pp .pm-ctx summary::-webkit-details-marker{display:none}
@media (hover:hover){.pp .pm-ctx summary:hover{color:var(--fg-2)}}
.pp .pm-ctx summary .pm-car{margin-left:auto;transition:rotate .2s var(--ease)}
.pp .pm-ctx[open] summary .pm-car{rotate:90deg}
.pp .pm-ctx .pm-bad{color:var(--p-blocking)}
.pp .pm-ctx-in{padding:0 16px 14px;display:grid;gap:12px}
.pp .pm-comp-ft{display:flex;align-items:center;gap:8px;padding:10px 12px 10px 16px;box-shadow:inset 0 1px 0 var(--line);flex:none}
.pp .pm-comp-ft .pm-hint{margin-right:auto}
.pp .pm-hint{display:inline-flex;align-items:center;gap:6px;font:400 12px/16px var(--sans);color:var(--fg-3)}
.pp .pm-lbl{font:500 11px/16px var(--sans);color:var(--fg-3);letter-spacing:.01em}
.pp .pm-log{display:grid;gap:2px;font:400 11px/18px var(--mono);color:var(--fg-2)}
.pp .pm-log div{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:10px;min-width:0}
.pp .pm-log span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-log .e{color:var(--p-blocking)}
.pp .pm-log .w{color:var(--p-important)}
.pp .pm-log .g{color:var(--ok)}
.pp .pm-log .m{color:var(--fg-3)}
`;
