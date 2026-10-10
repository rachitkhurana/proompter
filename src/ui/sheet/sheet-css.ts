/**
 * CSS for the large surfaces (sheet and command menu), the entries list and the Publish tab. Every number is
 * copied from design/prototype.html (`/* surfaces *\/`, `/* sheet *\/`, `/* list *\/`, `.pub`).
 * Root classes carry the `pm-` prefix; inner prototype names are scoped under `.pm-surface` / `.pm-sheet`, so
 * nothing collides with the composer or the dock. Tokens come from `.pp` (src/ui/styles.css).
 */
export const SHEET_CSS = /* css */ `
.pp .pm-surface{background:var(--mat-2);backdrop-filter:var(--blur-2);-webkit-backdrop-filter:var(--blur-2);box-shadow:var(--sh-3),var(--edge);border-radius:16px;color:var(--fg)}
.pp .pm-surface .logo{width:20px;height:20px;border-radius:6px;background:linear-gradient(180deg,#ff7a7a,#ff5050);color:#fff;display:grid;place-items:center;flex:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 1px 2px rgba(0,0,0,.4)}
.pp .pm-surface .logo svg{width:12px;height:12px;stroke-width:2.4}
.pp .pm-surface .hint{display:inline-flex;align-items:center;gap:6px;font:400 12px/16px var(--sans);color:var(--fg-3)}
.pp .pm-surface .empty{display:grid;justify-items:center;gap:10px;padding:48px 24px;text-align:center;color:var(--fg-3);font:400 12.5px/18px var(--sans)}
.pp .pm-surface .empty .ei{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--fill-2);color:var(--fg-2)}
.pp .pm-surface .quote{margin:2px 0 6px;padding:2px 0 2px 12px;box-shadow:inset 2px 0 0 var(--acc);color:var(--fg-2);font-style:italic}
.pp .pm-vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}

/* sheet */
.pp .pm-sheet{position:fixed;top:12px;bottom:12px;right:12px;z-index:70;width:min(460px,calc(100vw - 24px));display:flex;flex-direction:column;overflow:hidden;translate:calc(100% + 24px) 0;transition:translate .38s var(--ease-drawer),opacity .14s var(--ease)}
.pp .pm-sheet.left{right:auto;left:12px;translate:calc(-100% - 24px) 0}
.pp .pm-sheet.on{translate:0 0}
.pp .pm-sheet.flip{transition:none}
.pp.pp .pm-sheet:focus,.pp.pp .pm-sheet:focus-visible{outline:none}
.pp .pm-sheet .sh-hd{display:flex;align-items:center;gap:10px;height:56px;padding:0 10px 0 16px;flex:none}
.pp .pm-sheet .sh-hd .t{flex:1;min-width:0}
.pp .pm-sheet .sh-hd .t b{display:block;font:600 13.5px/18px var(--sans);letter-spacing:-.008em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-sheet .sh-hd .t span{display:block;font:400 11.5px/16px var(--mono);color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-sheet .seg.sh-tabs{margin:0 12px 8px;flex:none}
.pp .pm-sheet .sh-bd{flex:1;overflow:auto;overscroll-behavior:contain;box-shadow:inset 0 1px 0 var(--line)}
.pp .pm-sheet .sh-ft{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;box-shadow:inset 0 1px 0 var(--line)}
.pp .pm-sheet .sh-ft .sp{flex:1}

/* list */
.pp .pm-sheet .grp{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;height:34px;padding:0 16px;font:500 12px/1 var(--sans);color:var(--fg-2);background:rgba(28,28,31,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:inset 0 -1px 0 var(--line)}
.pp .pm-sheet .grp .n{color:var(--fg-3);font-weight:400}
.pp .pm-sheet .row{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:grid;grid-template-columns:14px 52px 14px minmax(0,1fr) auto;align-items:center;gap:10px;height:40px;padding:0 16px;box-shadow:inset 0 -1px 0 var(--line);transition:background-color .1s var(--ease)}
@media (hover:hover){.pp .pm-sheet .row:hover{background:var(--fill-1)}}
.pp .pm-sheet .row.sel{background:var(--fill-2)}
.pp .pm-sheet .row .id{font:400 11.5px/1 var(--mono);color:var(--fg-3)}
.pp .pm-sheet .row .t{font:400 13px/20px var(--sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-sheet .row.resolved .t{color:var(--fg-3)}
.pp .pm-sheet .row .r{display:flex;align-items:center;gap:8px;color:var(--fg-3);font:400 11.5px/1 var(--sans)}

/* publish */
.pp .pm-sheet .pub{padding:20px;display:grid;gap:20px}
.pp .pm-sheet .pub h3{margin:0 0 4px;display:flex;align-items:center;gap:8px;font:600 15px/22px var(--sans);letter-spacing:-.01em}
.pp .pm-sheet .pub p{margin:0;font:400 13px/20px var(--sans);color:var(--fg-2)}
.pp .pm-sheet .pub section{display:grid;gap:10px}
.pp .pm-sheet .tree{padding:10px 14px;border-radius:10px;background:rgba(0,0,0,.3);box-shadow:inset 0 0 0 1px var(--line);font:400 11.5px/20px var(--mono);color:var(--fg-2);overflow-x:auto}
.pp .pm-sheet .tree div{white-space:nowrap}
.pp .pm-sheet .tree .a{color:var(--ok)}
.pp .pm-sheet .tree .m{color:var(--p-important)}
.pp .pm-sheet .ilist{border-radius:10px;box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.pp .pm-sheet .irow{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:10px;align-items:center;height:40px;padding:0 12px;box-shadow:inset 0 -1px 0 var(--line);font:400 13px/1 var(--sans)}
.pp .pm-sheet .irow:last-child{box-shadow:none}
.pp .pm-sheet .irow span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
