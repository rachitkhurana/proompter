/**
 * CSS for the ticket (the entry detail view inside the sheet). Numbers copied from design/prototype.html
 * (`/* ticket *\/`). Scoped under `.pm-sheet`, so it only applies inside the sheet.
 *
 * Differences from the prototype: the snapshot is a PNG (`<img>`), not a live HTML iframe, so the highlight
 * box is gone and the Element/Viewport toggle switches between the two PNGs the capture produced.
 */
export const TICKET_CSS = /* css */ `
.pp .pm-sheet .tk{display:flex;flex-direction:column;flex:1;height:100%;min-height:0}
.pp .pm-sheet .tk-crumb{display:flex;align-items:center;gap:6px;height:44px;padding:0 10px 0 12px;font:400 12px/1 var(--sans);color:var(--fg-3);box-shadow:inset 0 -1px 0 var(--line);flex:none}
.pp .pm-sheet .tk-crumb b{color:var(--fg-2);font-weight:500}
.pp .pm-sheet .tk-crumb .sp{flex:1}
.pp .pm-sheet .tk-crumb .ttl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pp .pm-sheet .tk-main{padding:20px 20px 4px;display:grid;gap:10px}
.pp .pm-sheet .tk-title{margin:0;font:600 18px/26px var(--sans);letter-spacing:-.016em;text-wrap:balance}
.pp .pm-sheet .tk-desc{margin:0;font:400 13.5px/22px var(--sans);color:var(--fg-2);max-width:62ch;white-space:pre-wrap}
.pp .pm-sheet .tk-sec{padding:16px 20px;display:grid;gap:10px;box-shadow:inset 0 1px 0 var(--line)}
.pp .pm-sheet .tk-sec>h4{margin:0;display:flex;align-items:center;gap:8px;font:500 12px/16px var(--sans);color:var(--fg-3)}
.pp .pm-sheet .tk-sec>h4 .sp{flex:1}
.pp .pm-sheet .kv{display:grid;grid-template-columns:96px minmax(0,1fr);row-gap:2px;column-gap:12px;align-items:center;margin:0}
.pp .pm-sheet .kv dt{font:400 12.5px/30px var(--sans);color:var(--fg-3)}
.pp .pm-sheet .kv dd{margin:0;min-width:0;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.pp .pm-sheet .kv .val{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 8px;margin-left:-8px;border-radius:7px;font:400 13px/1 var(--sans);color:var(--fg);max-width:calc(100% + 8px);transition:background-color .12s var(--ease)}
.pp .pm-sheet .kv .val.ro{cursor:default}
@media (hover:hover){.pp .pm-sheet .kv .val:not(.ro):hover{background:var(--fill-2)}}
.pp .pm-sheet .kv .val[aria-expanded="true"]{background:var(--fill-2)}
.pp .pm-sheet .kv .val>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-sheet .kv .val.mono{font:400 12px/1 var(--mono)}
.pp .pm-sheet .kv .val .mute{color:var(--fg-3)}
.pp .pm-sheet .crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;font:400 12.5px/20px var(--sans);color:var(--fg-3)}
.pp .pm-sheet .crumbs>span:last-child{color:var(--fg)}
.pp .pm-sheet .shot{position:relative;aspect-ratio:16/9;max-width:100%;border-radius:10px;overflow:hidden;background:#0c0e13;box-shadow:inset 0 0 0 1px var(--line-2)}
.pp .pm-sheet .snap{aspect-ratio:auto;min-height:150px;display:grid;place-items:center;transition:height .25s var(--ease)}
.pp .pm-sheet .snap img{display:block;width:100%;height:auto;max-height:300px;object-fit:contain;opacity:0;transition:opacity .22s var(--ease)}
.pp .pm-sheet .snap img.ld{opacity:1}
.pp .pm-sheet .snap .mode{position:absolute;right:8px;top:8px;z-index:1;display:flex;gap:2px;padding:2px;border-radius:8px;background:rgba(9,9,11,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:inset 0 0 0 1px var(--line-2)}
.pp .pm-sheet .snap .mode button{all:unset;cursor:pointer;height:22px;padding:0 8px;border-radius:6px;font:500 11.5px/22px var(--sans);color:var(--fg-3)}
.pp .pm-sheet .snap .mode button.on{background:var(--fill-3);color:var(--fg)}
.pp .pm-sheet .snap-empty{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:8px;color:var(--fg-3);font:400 12.5px/18px var(--sans);text-align:center;padding:16px}
.pp .pm-sheet .shot .cap{position:absolute;left:8px;bottom:8px;display:flex;gap:6px}
.pp .pm-sheet .shot .cap .chip{background:rgba(9,9,11,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.pp .pm-sheet .ctabs{display:flex;gap:2px}
.pp .pm-sheet .ctabs button{all:unset;cursor:pointer;height:24px;padding:0 8px;border-radius:6px;font:500 12px/1 var(--sans);color:var(--fg-3);display:flex;align-items:center;gap:6px}
.pp .pm-sheet .ctabs button.on{background:var(--fill-2);color:var(--fg)}
.pp .pm-sheet .ctabs .bad{color:var(--p-blocking);font-weight:400}
.pp .pm-sheet .log{display:grid;gap:2px;font:400 11px/18px var(--mono);color:var(--fg-2)}
.pp .pm-sheet .log>div{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:10px;min-width:0}
.pp .pm-sheet .log span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-sheet .log .e{color:var(--p-blocking)}
.pp .pm-sheet .log .w{color:var(--p-important)}
.pp .pm-sheet .log .g{color:var(--ok)}
.pp .pm-sheet .log .m{color:var(--fg-4)}
.pp .pm-sheet .log-none{font:400 12px/18px var(--sans);color:var(--fg-3)}
.pp .pm-sheet .act{display:grid;gap:0;position:relative}
.pp .pm-sheet .act>div{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:10px;align-items:start;padding:5px 0;font:400 12.5px/20px var(--sans);color:var(--fg-2)}
.pp .pm-sheet .act>div b{color:var(--fg);font-weight:500}
.pp .pm-sheet .act>div time{font:400 11.5px/20px var(--sans);color:var(--fg-4)}
.pp .pm-sheet .act .dot{width:20px;height:20px;display:grid;place-items:center;color:var(--fg-3)}
.pp .pm-sheet .act .dot i{width:6px;height:6px;border-radius:50%;background:var(--fg-4);box-shadow:0 0 0 3px #1a1a1d}
.pp .pm-sheet .md{margin:0;padding:12px 14px;border-radius:10px;background:rgba(0,0,0,.3);box-shadow:inset 0 0 0 1px var(--line);font:400 11px/18px var(--mono);color:var(--fg-2);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto}
`;
