# Security Policy

## Supported versions

All plugins in this repository are published to npm under the
`@freespace8` scope. The latest published version of each plugin is
supported; older versions are patched on a best-effort basis when a fix
lands in a newer release.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report
vulnerabilities privately by opening a GitHub
[security advisory](https://github.com/freespace8/dsh-plugins/security/advisories/new)
on this repository.

Please include:

- the affected package name and version;
- a description of the vulnerability and its impact;
- steps to reproduce, or a minimal proof of concept;
- any suggested fix, if you have one.

You should receive an acknowledgement within a few business days. We will
coordinate a fix and release with you before public disclosure.

## Security notes for users

These plugins execute commands and access local resources on your machine:

- `dsh-deepseek-balance` runs `curl` against the official DeepSeek balance
  endpoint using your stored API key. The key is passed via the process
  environment, never logged.
- `dsh-free-vision` runs a local Swift process and accepts image uploads
  from the Web GUI. Uploads are restricted to loopback connections,
  size-limited, and validated by magic-number sniffing (client-supplied
  filenames are never trusted). HTTP downloads refuse local/private network
  addresses to prevent SSRF.
- `dsh-at-file` never reads the contents of mentioned files; it only
  validates path existence and injects a reference marker.

Use these plugins only in environments you trust.
