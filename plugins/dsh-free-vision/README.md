# @freespace8/dsh-free-vision

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS%2011%2B-blue)]()

Local image understanding for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Uses the **macOS Vision framework on your own machine** — images never leave
your Mac — and exposes the capability as agent-callable tools, so models
without vision (e.g. DeepSeek v4 Flash) can still see.

**English** · [简体中文](README.zh-CN.md)

---

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Verification](#verification)
- [License](#license)

## Features

- **`view_image`** — semantic understanding of textless images: scene
  classification, person/animal/face detection (nine-grid position),
  QR/barcode decoding, composition focus, and an aesthetic score; when text
  is detected it suggests using OCR instead;
- **`ocr_image`** — extracts all text from an image (reading order, Chinese
  and English); with `layout=true` it also outputs table structure and
  normalized coordinates — ideal for long screenshots, document photos, and
  table pages;
- **Paste image → local path** (Web GUI): paste an image with ⌘V in the
  composer; it is saved to a local directory and its absolute path is
  inserted into the draft, ready for the model to call the two tools above.

Inputs accepted: http(s) URLs / base64 / local absolute paths. Security
boundaries: downloads refuse local/private network addresses (SSRF
protection); uploads only accept loopback connections, are size-limited, and
are validated by magic-number sniffing (client-supplied filenames are never
trusted).

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a
  running `web` profile;
- **macOS 11+** with Xcode Command Line Tools (`xcode-select --install`).
  The first call compiles the Swift script (~5–10 s); afterwards it is
  cached.

## Installation

Published on npm — install with a single command (target profile `web`):

```sh
dsh plugin --profile web add @freespace8/dsh-free-vision
```

After installing, **restart the web profile** (`dsh plugin add` only updates
the manifest and dependencies; a running instance does not hot-load a new
bundle). To uninstall:

```sh
dsh plugin --profile web remove @freespace8/dsh-free-vision
```

## Configuration

Override any field in the profile's `cordis.patch.yml` by id (the `config`
block is replaced wholesale):

```yaml
- id: free-vision
  config:
    scriptPath: ""              # absolute path to ocr.swift; empty = use the bundled script
    timeout: 120000             # swift execution timeout (ms); keep it generous for first-run compilation
    saveDir: ""                 # directory for pasted images; default ~/Pictures/dsh-free-vision
    maxImageSize: 20971520      # max pasted-image size (bytes); default 20 MB
```

## How it works

- **Host half** (`src/index.js` + `src/swift.js` + `src/upload.js`): registers
  the `view_image` / `ocr_image` tools (`ctx.tools.register`); normalizes image
  input (local path / http / base64), then spawns `swift scripts/ocr.swift`
  via `ctx.subprocess` (process-group management, bounded output, timeout /
  cancel termination); also registers the `/plugins/dsh-free-vision/images`
  upload route (lazily on the webServer; skipped automatically in headless
  mode);
- **Client half** (`lib/client.js`): registers a
  `conversation.input.right` slot entry (renders null), captures image pastes
  in the composer, POSTs each to the upload route, and appends the returned
  absolute path to the draft (`inputActions.setDraft`).

Tool output contract: `output.schema = { type: 'string' }`; `render` returns
`[{ type: 'text', text }]` blocks (a hard requirement of dsh-session for
tool-result blocks).

## Verification

```sh
npm run check   # artifact gate: syntax, export shapes, exports/files, patch line, client id, script existence
```

Real-behavior verification (after installing into a profile): restart the web
profile → open a new session → paste a screenshot with text into the composer
→ the draft contains a local absolute path → ask the model to call
`ocr_image` with that path → the image's text is returned.

## License

MIT — see [LICENSE](LICENSE). `scripts/ocr.swift` and parts of the host/client
logic are derived from
[niyongsheng/free-vision-skill](https://github.com/niyongsheng/free-vision-skill)
(MIT, Copyright (c) 2026 Nico); the upstream copyright and license text are
retained in `LICENSE`.
