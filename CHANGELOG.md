# Changelog

## 0.0.2 (2026-10-10)

- **Accessibility:** the publish view's list of pending files can now take keyboard focus, so long paths that
  scroll sideways can be read without a mouse.
- **npm page:** the package page no longer lists the private `./internal/fixtures` export. Installs were never
  affected.
- Published from GitHub Actions with npm trusted publishing and provenance.

## 0.0.1 (2026-10-10)

First release.

- **Review layer** in a shadow root over your own Next app, behind `NEXT_PUBLIC_PROOMPTER=true`. With the flag
  unset, nothing reaches the production bundle.
- **Pick tools:** element, several elements, box, text and page note. Pick with the mouse or the keyboard
  (`↑`/`↓` walk parents and children).
- **Viewports:** Responsive (the live page) plus Desktop, Tablet and Mobile device frames, with rotate. Pins show
  on the viewport they were filed on.
- **Entries:** a composer with intent and priority, an entries sheet, tickets, and a command menu (`⌘⇧K`).
- **Context:** the source location (`withProompter` stamps `data-src` at build time), the component stack,
  console and network logs (redacted), an element crop and a viewport snapshot.
- **Files:** each entry is a markdown file under `reviews/<date>_<session>/`, written by a dev-only route
  (`@rachitkay/proompter/next/route`) and readable by people and AI agents. Redaction fails closed.
- **Works inside host modals:** an open app dialog (Radix and similar) stays open while you use the kit.
- **Plugins** for task links, test-plan sections, extra fields and redaction.
