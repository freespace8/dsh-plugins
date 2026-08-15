# DeepSeek Harness Plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm scope: @freespace8](https://img.shields.io/badge/npm-%40freespace8-blue)](https://www.npmjs.com/search?q=%40freespace8)

A collection of open-source plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the plugin-based AI development environment where "everything is a plugin".

Every plugin in this repository is published as an **independent npm package**
under the `@freespace8` scope and can be installed into any DSH profile on its
own. Each package ships a host half (Cordis plugin, plain ESM) and a client
half (browser bundle), with source kept in `plugins/<name>/`.

**English** · [简体中文](README.zh-CN.md)

---

## Table of contents

- [Plugins](#plugins)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Update & uninstall](#update--uninstall)
- [Install from source](#install-from-source)
- [Development](#development)
  - [Repository layout](#repository-layout)
  - [Adding a new plugin](#adding-a-new-plugin)
  - [Conventions](#conventions)
- [Verification](#verification)
- [Contributing](#contributing)
- [License](#license)

## Plugins

| Package | Description | Install |
|---|---|---|
| [@freespace8/dsh-deepseek-balance](plugins/dsh-deepseek-balance/README.md) | Official DeepSeek API balance pill in the Web GUI session header. Auto-hidden for non-official models; click-to-refresh and timed refresh. | `dsh plugin --profile web add @freespace8/dsh-deepseek-balance` |
| [@freespace8/dsh-free-vision](plugins/dsh-free-vision/README.md) | Local image understanding for vision-less models: OCR, table-layout detection, and semantic description of textless images (macOS Vision, fully on-device), plus paste-image → local path in the Web GUI. | `dsh plugin --profile web add @freespace8/dsh-free-vision` |
| [@freespace8/dsh-at-file](plugins/dsh-at-file/README.md) | Codex-style `@` path mentions: type `@` in the composer to pick a workspace file/folder, reference its path, and let the host validate & mark it on send (contents are never read). | `dsh plugin --profile web add @freespace8/dsh-at-file` |

## Prerequisites

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a
  running `web` profile (Node.js `^22.19.0` or `>=24.0.0`).
- [pnpm](https://pnpm.io/installation) — `dsh plugin` delegates to it
  (`corepack enable` works too).
- `dsh-free-vision` additionally requires **macOS 11+** with Xcode Command
  Line Tools (`xcode-select --install`).

## Installation

`dsh plugin` forwards to pnpm, so packages install straight from the npm
registry:

```sh
# Install a single plugin
dsh plugin --profile web add @freespace8/dsh-deepseek-balance

# Install several at once
dsh plugin --profile web add @freespace8/dsh-deepseek-balance @freespace8/dsh-free-vision @freespace8/dsh-at-file
```

After installing, **restart the target profile** — `dsh plugin add` only
updates the manifest and dependencies; a running instance does not hot-load a
new bundle.

### Update & uninstall

```sh
# Update to the latest version
dsh plugin --profile web update @freespace8/dsh-deepseek-balance

# Uninstall
dsh plugin --profile web remove @freespace8/dsh-deepseek-balance
```

`add` installs `latest` by default; `update` pulls the newest published
version.

## Install from source

Want to hack on a plugin or avoid waiting for a release? Clone the repo and
install with a `file:` path:

```sh
git clone https://github.com/freespace8/dsh-plugins.git
dsh plugin --profile web add file:./dsh-plugins/plugins/dsh-deepseek-balance
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

## Development

### Repository layout

```
plugins/
├── dsh-deepseek-balance/   # official DeepSeek API balance pill
├── dsh-free-vision/        # local macOS Vision OCR / image understanding
└── dsh-at-file/            # Codex-style @ path mentions
```

Each plugin is self-contained: `src/` (host), `lib/client.js` (browser
bundle), `cordis.patch.yml` (bundle patch line), `tests/` (artifact gate),
plus its own `README.md` and `LICENSE`.

### Adding a new plugin

1. Copy the skeleton from `plugins/dsh-deepseek-balance`
   (`package.json`, `cordis.patch.yml`, `src/index.js`, `lib/client.js`,
   `README.md`, `tests/check.mjs`) and rename it to a scoped
   `@freespace8/<name>`.
2. Implement the host half in `src/index.js`
   (`export const name` + `export const Config` + `apply(ctx, config)`) and
   the client half in `lib/client.js`
   (`window.__ModuleLoader__.load({ id: <package name>, factory })`).
3. Keep three identifiers in sync: the `package.json` name, the `name` field
   of the `cordis.patch.yml` insert line (quote scoped names), and the client
   bundle `id`.
4. Add an artifact-gate check in `tests/check.mjs` and make sure
   `npm run check` passes.
5. Publish with `npm publish` (`publishConfig.access` is already `public`),
   then update the install commands in this README and the plugin README.

### Conventions

- **Zero-build**: hosts are plain ESM with no third-party imports beyond
  `@deepseek-ai/schemastery` (plus `zod` / `@deepseek-ai/dsh-llm` where the
  host genuinely needs them); clients use `React.createElement` with no
  bundler. No `tsc` / `tsdown` pipeline is required.
- **Host ↔ client communication** (either is fine):
  - *HTTP route* — the host registers `/plugins/<package>/...` and the client
    `fetch`es it (see `dsh-deepseek-balance`);
  - *Typert Remote* — the host registers with `ctx.typert.register` +
    `TypertRemoteService`, the client mounts with `ctx.remote.$mount`
    (see `dsh-at-file`; third-party packages can extend typert endpoints, no
    longer limited by the api-remotes allow-list).
- **Tunables go into Config**: clients have no config channel, so values the
  client needs (e.g. refresh intervals) are delivered via the host route
  response or Remote `getSettings`.
- **Registration is an effect**: routes, styles, and subscriptions are
  registered through `ctx.effect` / `ctx.on` so they are cleaned up on
  dispose.

## Verification

Run the artifact gate for the plugin you changed (from the plugin directory):

```sh
npm run check
```

This validates syntax, export shapes, `exports`/`files` consistency, patch
lines, and client bundle ids without booting a profile. Real-behavior
verification is done by installing a plugin into a profile and testing in the
GUI (see each plugin's README).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md)
first, and check [SECURITY.md](SECURITY.md) before reporting a vulnerability.
Bug reports and feature requests go to the
[issue tracker](https://github.com/freespace8/dsh-plugins/issues).

## License

MIT. See [LICENSE](LICENSE). Third-party attributions for derived code are
documented in each plugin's own `LICENSE`:

- `dsh-at-file` — independent implementation of the `@`-mention concept from
  [dsh-at-file](https://github.com/FSMargoo/dsh-at-file) (MIT).
- `dsh-free-vision` — adaptation of
  [free-vision-skill](https://github.com/niyongsheng/free-vision-skill) (MIT).
