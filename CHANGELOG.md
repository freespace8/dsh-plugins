# Changelog

All notable changes to the DeepSeek Harness plugin collection are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@freespace8/dsh-sidebar-helper@0.1.0` — right-click context menus for the
  Web GUI workspace sidebar, built by **reusing the built-in "⋯" row menus**:
  the **workspace menu itself carries Copy Path** — a global `MutationObserver`
  injects it as the first item (next to Rename) whenever a workspace row's
  menu opens, whether via left-click on "⋯", right-click on the row, or
  keyboard, and it writes the workspace directory into the clipboard with a
  brief "已复制 / Copied" state before closing. Conversation (session) rows
  keep their own untouched menu (Rename / Fork / Archive — identical to the
  three dots). The injected item is pinned through React re-renders by a
  `MutationObserver` and cleaned up on menu close / plugin dispose. Rows are
  identified through stable semantic attributes (`role="treeitem"` +
  `aria-expanded`/`aria-selected`) against live workspace snapshots — no
  hashed CSS classes, zero client-side dependencies.

## [Released 2026-08-16]

Published to npm:

- `@freespace8/dsh-deepseek-balance@0.1.2`
- `@freespace8/dsh-free-vision@0.1.2`
- `@freespace8/dsh-at-file@0.2.2`

Contents of this release:

### Added

- `@freespace8/dsh-free-vision` — local image understanding for DeepSeek
  Harness: OCR / table layout / semantic description of textless images via
  macOS Vision (fully local), plus paste-image → local-path support in the Web
  GUI.
- `@freespace8/dsh-at-file` — Codex-style `@` path mentions for the Web GUI
  composer (workspace file/folder picker, keyboard navigation, `@path` pills,
  host-side existence validation with `<workspace-reference>` injection).
- `@freespace8/dsh-deepseek-balance` — official DeepSeek API balance pill in
  the Web GUI session header (click-to-refresh, timed refresh, auto-hide for
  non-official models).

### Changed

- Unified package metadata for npm publishing: `author`, `homepage`, `bugs`,
  `engines`, expanded `keywords`, and English-first descriptions across all
  published packages.
- Documentation is now bilingual (English primary + 简体中文) for all packages.
- Preview images downscaled to 1280 px and optimized (~4× smaller) for faster
  page loads; `dsh-free-vision` preview replaced with a real GUI usage
  screenshot.
- README preview images now use absolute GitHub URLs so they render on
  npmjs.com (relative paths are not resolved there).

### Fixed

- Repo hygiene: added `.gitignore`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `SECURITY.md`.
- License files unified under the `freespace8` copyright holder, with upstream
  MIT attributions retained and clearly documented.

## [Released 2026-08-16]

Published to npm:

- `@freespace8/dsh-at-file@0.2.3`

### Changed

- `dsh-at-file` — documentation only: clarified the `@` picker keyboard
  navigation. **Enter** on a directory enters it (keep descending); **Tab**
  confirms the selection immediately for both files and directories, so a
  directory can be picked as-is (without entering it) by highlighting it and
  pressing Tab.

## [Unreleased]
