/**
 * CSS for the device stage: stage, bezel, clip, caption, and the "can't be framed" notice.
 * Numbers copied from design/prototype.html (`/* surfaces *\/`, `.stage`, `.dwrap`, `.dclip`, `.devcap`).
 * Rendered by `<ViewportStyles />`; see overlay-styles.ts for why it isn't in styles.css.
 */
export const viewportCss = /* css */ `
.pp .pm-stage{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:radial-gradient(80% 60% at 50% 40%,#131316 0,var(--canvas) 70%)}
.pp .pm-dwrap{position:relative;flex:none;background:#000;border-radius:var(--br,20px);padding:var(--bz,8px);box-shadow:0 0 0 1px rgba(255,255,255,.09),inset 0 0 0 1px rgba(255,255,255,.04),0 50px 100px -30px rgba(0,0,0,.9);transition:width .45s var(--ease-drawer),height .45s var(--ease-drawer)}
.pp .pm-dclip{position:relative;width:100%;height:100%;overflow:hidden;border-radius:var(--cr,0)}
.pp .pm-dclip iframe{border:0;display:block;transform-origin:0 0;background:#0c0e13}
.pp .pm-dclip iframe[data-blocked]{visibility:hidden}
.pp .pm-devcap{position:absolute;left:50%;translate:-50% 0;display:flex;gap:8px;align-items:center;font-size:12px;line-height:16px;color:var(--fg-3);white-space:nowrap}
.pp .pm-devcap b{color:var(--fg-2);font-weight:500}
.pp .pm-devcap .dot{width:3px;height:3px;border-radius:50%;background:var(--fg-4)}
.pp .pm-notice{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;text-align:center;background:#0c0e13}
.pp .pm-notice p{margin:0;max-width:300px;font:400 12.5px/18px var(--sans);color:var(--fg-2)}
.pp .pm-notice b{display:block;margin-bottom:4px;font:500 13px/18px var(--sans);color:var(--fg)}
`;
