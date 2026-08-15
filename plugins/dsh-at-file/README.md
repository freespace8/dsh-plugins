# @freespace8/dsh-at-file

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Codex-style `@` path mentions for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI. Type `@` in the composer to open a picker over the current workspace's files and folders; selecting one drops a readable `@path` token into the draft. Before sending, the host validates (at the `agent/pre-step` boundary) that the selected paths actually exist in the workspace and injects a **presence-only** reference for the model:

```xml
<workspace-reference path="docs/spec.pdf" kind="file" />
```

**The plugin only passes paths — it never reads file contents and never
expands directory descendants.** Whether and how to inspect a reference is up
to the agent's existing tools for the current session.

**English** · [简体中文](README.zh-CN.md)

---

## Table of contents

- [Features](#features)
- [Preview](#preview)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Dependencies](#dependencies)
- [Verification](#verification)
- [License](#license)

## Features

- **`@`-triggered picker with a directory-navigation model**: the query is
  split at the last `/` into "containing directory + filter keyword" — typing
  `plugins/d` only lists the **direct children** of `plugins` whose names
  contain `d` (no more whole-workspace fuzzy matching). Directories come
  first, files after, each sorted alphabetically.
- **Keyboard navigation**: with a **directory** highlighted, **Enter** enters
  that directory (the menu immediately refreshes to its direct children, e.g.
  `@dir/`); **Tab** confirms the selection immediately — for **both files and
  directories** it inserts `@path ` and finishes (a directory is never
  descended into). File + Enter follows the normal selection flow. Mouse
  click selects directly (inserts `@path `).
- **Real text, zero state**: the draft holds the readable `@path`; the pill is
  only a decorative layer drawn after mirror-measurement — variable width,
  no truncation, no overlap, with margin on all sides (not exceeding the
  line). Selection acts on ordinary text.
- **Whole-token deletion**: after a selection is confirmed (menu closed), when
  the caret is inside an `@path`, directly adjacent to it, or on its trailing
  separator space, a single Backspace/Delete removes the whole reference
  (one press — no need to press twice), and the `@` picker does **not** pop
  up. Everywhere else, editing stays character-by-character. While the `@`
  menu is still open (typing a filter, not yet confirmed), Backspace/Delete
  is **not** intercepted and trims the filter character-by-character with the
  menu refreshing live.
- **Host validation on send**: the host checks path existence and marks the
  references into the model-visible input; the submitted text matches the
  draft verbatim.
- **Settings page (设置 → 文件提及)**: enable toggle, global file-filter rules
  (Exact / Regex, each with independent case-sensitivity).
- **Built-in ignore list**: common version-control, IDE metadata, dependency
  trees, cache and build-output directories; fully overridable via config.

## Preview

The picker as it appears when you type `@` in the composer:

![dsh-at-file @ path reference picker preview](https://raw.githubusercontent.com/freespace8/dsh-plugins/main/plugins/dsh-at-file/images/preview.png)

## Installation

Published on npm — install with a single command (target profile `web`):

```sh
dsh plugin --profile web add @freespace8/dsh-at-file
```

After installing, **restart `dsh web`** (the host and the browser client load
together). To uninstall:

```sh
dsh plugin --profile web remove @freespace8/dsh-at-file
```

## Usage

Type `@` in a session composer: candidates render on a single line, the popup
width matches the composer, file names show in full (never truncated), and
the containing directory follows after (same-named files are distinguished by
directory). **Directories come first, files after, each sorted
alphabetically.**

The query is split at the last `/` into "directory + keyword": `@plugins/d`
shows only the direct children of `plugins` whose names contain `d`;
`@plugins/` shows all direct children of `plugins`. **While the menu is open,
Backspace/Delete edits the filter character-by-character.**

Keyboard navigation: with a **directory** highlighted, **Enter** enters it
(the menu refreshes to its children; keep descending, e.g.
`@plugins/dsh-at-file/lib/`); **Tab** confirms immediately — for both files
and directories it inserts `@path ` and a directory is never descended into.
Mouse click selects the highlighted entry directly.

Selecting an entry turns it into a pill whose width hugs the full
`@relative-path` with at least 2 px of margin (and 2–3 px above/below, never
exceeding its line). Multiple pills are separated by natural spaces and never
overlap; long paths display in full without truncation. After a selection is
confirmed (menu closed), with the caret inside a pill, adjacent to it, or on
its separator space, a single Backspace/Delete removes the whole pill (the
`@` list does not pop up); everywhere else editing stays
character-by-character.

## Configuration

Override any field in the profile's `cordis.patch.yml` by id (the `config`
block is replaced wholesale):

```yaml
- id: dsh-at-file
  config:
    maxIndexedFiles: 10000   # per-workspace index entry cap (default 5000)
    ignoreDirs: []           # directory basenames skipped during indexing (defaults in src/defaults.js)
```

The toggle and filter rules in **设置 → 文件提及** are persistent settings that
take effect in real time — no restart needed.

## Project structure

```
plugins/dsh-at-file/
├── src/
│   ├── index.js      # host entry: atFile Remote service, Typert manifest, settings namespace, pre-step boundary
│   ├── contract.js   # zod wire contract + invocation descriptors (shared host/client)
│   ├── defaults.js   # default ignored dirs/files + filter-rule normalization
│   ├── files.js      # streaming workspace directory index (no symlinks, bounded truncation)
│   └── mention.js    # @path scanning, validation, <workspace-reference> injection
├── lib/client.js     # client half (zero-build bundle): @ trigger source, PillOverlay (mirror measurement + variable-width pills), settings section, locale
├── cordis.patch.yml  # bundle patch line
└── tests/            # check.mjs artifact gate + unit.mjs pure-logic unit tests
```

## Dependencies

- **Host** additionally depends on `zod` (the Typert registry/gateway requires
  zod-style schemas with `.parse()`, which schemastery lacks) and
  `@deepseek-ai/dsh-llm` (for constructing user messages). Both resolve from
  the harness root `node_modules`, so a local `file:` install needs **no
  `pnpm install` inside the plugin directory**; on npm, `dependencies.zod`
  is installed automatically.
- **Client**: zero external imports — `require` can only hit platform seed
  modules (react), so the wire contract, search, icons, and styles are all
  inlined in `lib/client.js` (a minimal zod-compatible codec with only
  `.parse()`, which is all `ClientRemote` needs).

## Verification

```sh
npm run check     # artifact gate + pure-logic unit tests
```

The client side has been visually verified in the real GUI (`dsh web`,
installed into the `web` profile): root-level `@` list (directories first,
files after), `@plugins/d` in-directory keyword filtering, Enter/Tab
directory navigation, file selection, mouse click, pills and whole-token
deletion all work. The host side (pre-step validation and
`<workspace-reference>` injection) has not been re-run in a real combination
(no host changes this cycle; covered by unit tests).

## License

MIT — see [LICENSE](LICENSE). This package is an independent implementation of
the `@`-mention concept from
[dsh-at-file](https://github.com/FSMargoo/dsh-at-file) (MIT); the upstream
copyright notice is retained in `LICENSE` and the concept is credited here.
