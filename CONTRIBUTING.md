# Contributing

Thanks for your interest in contributing to the DeepSeek Harness plugin
collection! This document describes how to add, modify, and publish plugins.

## Repository layout

```
plugins/
├── dsh-deepseek-balance/   # official DeepSeek API balance pill
├── dsh-free-vision/        # local macOS Vision OCR / image understanding
└── dsh-at-file/            # Codex-style @ path mentions
```

Each directory is an independent npm package (`@freespace8/<name>`) with a
host half (`src/`) and a client half (`lib/client.js`).

## Adding a new plugin

1. Copy the skeleton from `plugins/dsh-deepseek-balance`
   (`package.json`, `cordis.patch.yml`, `src/index.js`, `lib/client.js`,
   `README.md`, `tests/check.mjs`).
2. Rename the package to a scoped `@freespace8/<name>` and implement the
   plugin's responsibility:
   - host half in `src/index.js` (`export const name` + `export const Config`
     + `apply(ctx, config)`);
   - client half in `lib/client.js`
     (`window.__ModuleLoader__.load({ id: <package name>, factory })`).
3. Keep three identifiers in sync: the `package.json` name, the `name` field
   of the `cordis.patch.yml` insert line (quote scoped names), and the client
   bundle `id`.
4. Add an artifact-gate check in `tests/check.mjs` and make sure
   `npm run check` passes.
5. Write bilingual documentation (`README.md` + `README.zh-CN.md`) and follow
   the conventions below.
6. Publish with `npm publish` (scoped packages are already configured with
   `publishConfig.access = "public"`), then update the install command in the
   README and this repository's root README table.

## Conventions

- **Zero-build**: hosts are plain ESM with no third-party imports beyond
  `@deepseek-ai/schemastery` (plus `zod` / `@deepseek-ai/dsh-llm` where the
  host genuinely needs them). Clients use `React.createElement` with no
  bundler. No `tsc` / `tsdown` pipeline is required.
- **Host ↔ client communication** (either is fine):
  - HTTP route: the host registers `/plugins/<package>/...` and the client
    `fetch`es it (see `dsh-deepseek-balance`);
  - Typert Remote: the host registers with `ctx.typert.register` +
    `TypertRemoteService`, the client mounts with `ctx.remote.$mount`
    (see `dsh-at-file`).
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
verification is done by installing the plugin into a profile and testing in
the GUI (see each plugin's README).

## Release process

- Bump the version before every publish: `patch` for fixes, `minor` for
  features, `major` for breaking changes (`npm version patch|minor|major`
  also creates the git tag).
- Run `npm run check` before publishing.
- Update `CHANGELOG.md` under `[Unreleased]`.

## Commit guidelines

- Write clear, imperative commit messages (e.g.
  `fix: handle empty balance response`).
- Keep unrelated changes in separate commits.

## Getting help

Open an [issue](https://github.com/freespace8/dsh-plugins/issues) for bugs,
feature requests, or questions before submitting a pull request.
