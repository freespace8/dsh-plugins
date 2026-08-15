# @freespace8/dsh-deepseek-balance

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness plugin that shows your **official DeepSeek API balance** as
a pill in the Web GUI session header (left of the Session log). It is shown
only when the current session model is an official DeepSeek model and
auto-hides for third-party relay/proxy models.

**English** · [简体中文](README.zh-CN.md)

---

## Table of contents

- [Features](#features)
- [Preview](#preview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Verification](#verification)
- [License](#license)

## Features

- Displays the official DeepSeek balance as `¥xx.xx` (no currency suffix) in
  the session header;
- Shown **only when the session's current model is an official DeepSeek model**
  (provider `deepseek-official`, i.e. `api.deepseek.com`) — third-party
  relay/proxy models hide it automatically;
- Hover shows the granted/topped-up breakdown and the last refresh latency;
- Click the refresh button in the pill to refresh immediately (with a spinner
  animation); auto-refreshes every 5 minutes;
- **No caching**: every refresh really calls the official endpoint; on failure
  the previous balance is kept and a red dot is shown.

## Preview

The pill as it appears in the session header (left of the Session log):

<img src="https://raw.githubusercontent.com/freespace8/dsh-plugins/main/plugins/dsh-deepseek-balance/images/preview.png" alt="DeepSeek official balance pill preview" width="640" />

> **Visibility**: the pill appears only when the session's current model is an
> official DeepSeek model (provider `deepseek-official`, i.e.
> `api.deepseek.com`). If you switch to a non-official DeepSeek relay/proxy
> model the pill hides; it reappears when you switch back to an official
> model.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a
  running `web` profile;
- A stored official DeepSeek API key: `DEEPSEEK_API_KEY` in
  `~/.dsh/.credentials.yaml` (or the same-name environment variable).

## Installation

Published on npm — install with a single command (target profile `web`):

```sh
dsh plugin --profile web add @freespace8/dsh-deepseek-balance
```

After installing, **restart the web profile** (`dsh plugin add` only updates
the manifest and dependencies; a running instance does not hot-load a new
bundle). To uninstall:

```sh
dsh plugin --profile web remove @freespace8/dsh-deepseek-balance
```

## Configuration

Override any field in the profile's `cordis.patch.yml` by id (the `config`
block is replaced wholesale):

```yaml
- id: deepseek-balance
  config:
    apiKeyEnv: DEEPSEEK_API_KEY   # credential name used for the balance request
    refreshIntervalMs: 300000     # auto-refresh interval (milliseconds)
    order: -1                     # pill order in the session header (lower = earlier)
    shellTimeoutMs: 8000          # total shell timeout for fetching the balance (ms)
```

## How it works

- **Host half** (`src/index.js`): resolves the API key via `ctx.credentials`,
  runs `curl https://api.deepseek.com/user/balance` through `ctx.shell`, and
  registers the HTTP route `/plugins/dsh-deepseek-balance/balance` to deliver
  the result (including the refresh-interval config) to the browser;
- **Client half** (`lib/client.js`): registers a
  `conversation.session.header.utilities` slot entry; reads the session's
  current model via `ctx.modelDirectories` to decide visibility; fetches the
  balance route to render the pill.

Balance data always comes from the **official DeepSeek endpoint** (using the
stored official key), regardless of which provider the model traffic goes
through; visibility depends only on whether the session's current model is an
official DeepSeek model.

## Verification

```sh
npm run check   # artifact gate: syntax, export shapes, exports/files, patch line, client id
```

Real-behavior verification (after installing into a profile): restart the web
profile → open an **existing session** → the balance pill appears in the
header; switch the model to a third-party relay model → the pill disappears;
switch back to official DeepSeek → the pill returns.

## License

MIT — see [LICENSE](LICENSE). This is an original work and contains no
third-party code.
