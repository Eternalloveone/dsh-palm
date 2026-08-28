# Security Policy

## Supported Versions

Only the latest release on the `main` branch receives security fixes. Older
releases are not supported unless explicitly noted here.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please **do not open a public issue** for a security vulnerability.

Send a private report instead:

- **GitHub**: use the repository's [Security Advisories](https://github.com/Eternalloveone/dsh-palm/security/advisories/new) page — "Report a vulnerability" creates a private advisory.
- If you cannot use GitHub, open a regular issue with the `security` label, but redact exploit details; the maintainer will move the discussion to a private channel.

You can expect an acknowledgement within 3 days and a first assessment within
7 days. Once a fix is ready, a new release will be cut and the advisory
published (unless the reporter asks to hold disclosure).

## Scope

The mobile surface runs inside the dsh host with a pairing-cookie gate on
every `/m/api` call and a method whitelist. Relevant areas are:

- Pairing and device trust (`src/pairing.ts`, the `/api/pair` route, channel rules)
- `/m/api` RPC gate and the `events.mux` bridge
- Markdown rendering (escape-first, protocol allow-list) and image URL handling
- Any place a remote peer can influence text, HTML or openers on the host

Out of scope: security of the dsh host itself (report to the
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) project),
or of your deployment's network edge (TLS termination, frp/Tailscale,
the cloud host).

## Deployment notes

- The pairing cookie is the trusted channel: keep your deployment entry
  HTTPS-only and never expose the host with `--host 0.0.0.0` on an
  unauthenticated port.
- Tailscale users should prefer a tailnet-only `serve` over public tunnels.
