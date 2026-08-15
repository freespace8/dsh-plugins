# Changelog

All notable changes to the DeepSeek Harness plugin collection are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

- Repo hygiene: added `.gitignore`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `SECURITY.md`.
- License files unified under the `freespace8` copyright holder, with upstream
  MIT attributions retained and clearly documented.
