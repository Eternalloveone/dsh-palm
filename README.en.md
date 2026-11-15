# dsh-palm

[简体中文](README.md) | [English](README.en.md)

**2.0.0** — the [dsh](https://github.com/deepseek-ai/deepseek-harness) desktop surface, on your phone. Same sessions, same progress: check status, reply, approve, tidy up. Complex configuration stays on the desktop.

## Quick start

```sh
dsh plugin --profile web add @eternalloveone/dsh-palm
dsh web          # restart dsh so it loads
```

Then open the phone icon in the sidebar, and either scan the QR code or type the six-digit code on your phone. If the phone cannot reach this machine, see [remote access](docs/remote-access.md).

## What it does

| Need | On the phone |
|---|---|
| See what the agent is doing | One screen for every running session: current action, step, elapsed time — tap to open |
| Reply | Text, camera, files, voice input; queue a message while a turn runs, edit or drop it |
| Approve | Tool approvals and questions arrive in real time; answers bind to the requesting device |
| Manage sessions | Long-press to pin / rename / delete; global search jumps to the matched message |
| Get notified | WxPusher / ServerChan (WeChat), Bark (iOS), Telegram, or Web Push |
| Change the look | 19 skins with their own strokes and icons, plus wallpapers |

Full list: [capabilities](docs/capabilities.md).

## What is new in 2.0

1. **First screen built once** — no more empty shell that grows; switching sessions stops re-reading the same log (6 → 3 requests, 510KB → 255KB)
2. **Windowing in the message list** — only the last 12 rows stay in the DOM (97 → 13 rows; p95 jank 229–392 ms → 81 ms)
3. **19 skins** — each with its own strokes, icons and background, not a recolour
4. **Self-healing stream** — SSE stall falls back to polling and switches back on recovery; a lagging window reloads its tail; a stuck gate times out instead of freezing

Upgrade notes: [UPGRADING.md](UPGRADING.md).

## Requirements

| Item | Value |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0-0` |
| Node | `^22.19.0` or `>=24.0.0` |
| Phone | Android Chrome/Edge/Firefox; iOS Safari installed to the home screen for PWA |

The `/m/api` method surface and frame formats are additive only — an older phone bundle keeps working against a newer host. Full matrix: [COMPATIBILITY.md](COMPATIBILITY.md).

## Docs

[Documentation index](docs/README.md) · [Notifications](docs/notifications.md) · [Remote access](docs/remote-access.md) · [Releasing](RELEASING.md)

## Attribution & license

A derivative work of [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) (Apache-2.0) — pairing protocol, original device-store format and panel skeleton are inherited; the `/m/` UI, render stack, `/m/api` whitelist, SSE mux and offline layer are independent. See [NOTICE](packages/dsh-palm/NOTICE). Licensed [Apache-2.0](LICENSE).
