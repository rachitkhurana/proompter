/**
 * CSS for the command menu. Numbers copied from design/prototype.html (`/* command menu *\/`, `.scrim`).
 * The prototype toggles an `.on` class; here Radix Dialog mounts and unmounts the content, so the same
 * fade and scale run as `data-state` keyframes (opacity .16s, scale .2s, both `--ease`; the scrim fades .2s).
 * Needs the base surface rules in SHEET_CSS (`.pm-surface`, `.logo`, `.hint`, `.empty`).
 */
export const COMMAND_CSS = /* css */ `
.pp .pm-scrim{position:fixed;inset:0;z-index:84;background:rgba(0,0,0,.32)}
.pp .pm-scrim[data-state="closed"],.pp .pm-cmd[data-state="closed"]{pointer-events:none}

.pp .pm-cmd{position:fixed;left:50%;top:16vh;translate:-50% 0;z-index:90;width:min(620px,calc(100vw - 24px));max-height:min(520px,72vh);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto}
.pp.pp .pm-cmd:focus,.pp.pp .pm-cmd:focus-visible{outline:none}

.pp .pm-cmd .cmd-in{display:flex;align-items:center;gap:12px;height:54px;padding:0 16px;box-shadow:inset 0 -1px 0 var(--line);color:var(--fg-3);flex:none}
.pp .pm-cmd .cmd-in input{all:unset;flex:1;min-width:0;font:400 15px/1 var(--sans);letter-spacing:-.006em;color:var(--fg)}
.pp .pm-cmd .cmd-in input::placeholder{color:var(--fg-4)}
.pp.pp .pm-cmd .cmd-in input:focus-visible{outline:none}
.pp .pm-cmd .cmd-ls{flex:1;overflow:auto;padding:6px}
.pp .pm-cmd .cmd-sec{padding:10px 10px 6px;font:500 11.5px/1 var(--sans);color:var(--fg-3)}
.pp .pm-cmd .cmd-it{box-sizing:border-box;width:100%;cursor:pointer;display:grid;grid-template-columns:26px auto minmax(0,1fr) auto;align-items:center;gap:10px;height:40px;padding:0 10px;border-radius:9px;font:400 13px/1 var(--sans);color:var(--fg)}
.pp .pm-cmd .cmd-it.kb{background:var(--fill-2)}
.pp .pm-cmd .cmd-it .ci{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:var(--fill-2);color:var(--fg-2);box-shadow:var(--edge)}
.pp .pm-cmd .cmd-it .sub{color:var(--fg-3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pm-cmd .cmd-it .r{display:flex;align-items:center;gap:4px;color:var(--fg-3);font-size:12px;justify-self:end}
.pp .pm-cmd .cmd-it > span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
.pp .pm-cmd .cmd-ft{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;box-shadow:inset 0 1px 0 var(--line);flex:none}
.pp .pm-cmd .cmd-ft .sp{flex:1}
.pp .pm-cmd .cmd-ft .hint kbd{margin-left:0}
`;

/**
 * The open and close animations. Kept apart because Radix waits for `animationend` before it unmounts the
 * closing content: happy-dom never fires it, so the unit tests render without this block (`animated={false}`).
 */
export const COMMAND_MOTION_CSS = /* css */ `
.pp .pm-scrim[data-state="open"]{animation:pm-scrim-in .2s var(--ease) both}
.pp .pm-scrim[data-state="closed"]{animation:pm-scrim-out .2s var(--ease) both}
@keyframes pm-scrim-in{from{opacity:0}}
@keyframes pm-scrim-out{to{opacity:0}}
.pp .pm-cmd[data-state="open"]{animation:pm-cmd-in .2s var(--ease) both}
.pp .pm-cmd[data-state="closed"]{animation:pm-cmd-out .2s var(--ease) both}
@keyframes pm-cmd-in{0%{opacity:0;scale:.97}80%{opacity:1}100%{scale:1}}
@keyframes pm-cmd-out{0%{opacity:1;scale:1}80%{opacity:0}100%{scale:.97}}
`;
