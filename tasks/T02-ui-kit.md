# T02 UI kit and shadow shell

**Owns:** `src/ui/primitives/**`, `src/ui/styles.css`, `src/ui/tokens.ts`, `src/ui/icons.tsx`,
`src/ui/shadow-root.tsx`, stories for the above.

**Do:**
- `ShadowRoot` mounts a container (`<proompter-root>`) on `document.body` and attaches an open shadow
  root. It injects the compiled CSS and renders children into it with a portal. Radix portals must
  target the shadow container. Export a hook for the container.
- Tokens: copy the prototype's `:root` block (colours, materials, blur, lines, shadows, easings, type).
  Add the reduced-transparency and contrast media variants.
- Primitives, styled to match the prototype:
  - `Button` (default, pri, ghost, sm)
  - `IconButton`
  - `Chip` (static, button, mono, accent, ghost)
  - `Kbd`
  - `Segmented`
  - `Tooltip` (350ms first, instant while warm, side-aware)
  - `Menu` (single and multi select, arrow keys, origin-aware scale-in)
  - `PriorityIcon`
  - `StatusIcon`
  - `Toast` (Sonner-style, max 3)
- Icons: port every path from the prototype's `P` object as typed React components.

- Dependencies per DESIGN §2 **D1**: `Menu` uses `@radix-ui/react-dropdown-menu`; the command menu's
  focus trap (T08) uses `@radix-ui/react-dialog`. Never the umbrella `radix-ui`. `Tooltip`, `Segmented`,
  `Chip` and the sheet are hand-built, as in the prototype. Every Radix portal gets `container` = the
  shadow container. No `motion`: CSS transitions/keyframes with the prototype's easing tokens, and the
  Web Animations API for code-driven motion.

**Done when:** each primitive has a story with all its states, axe is clean, and a story shows that host
CSS (`* { color: red !important }` outside) can't reach the shadow tree.
