# dsh-palm

**dsh in your palm** — the standalone mobile surface for the [dsh](https://github.com/deepseek-ai/deepseek-harness) web GUI: scan-to-pair device trust, the `/m/` phone UI, the `/m/api` RPC channel with a realtime SSE mux bridge, and a polished desktop pairing panel.

Derived from [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) — see [NOTICE](NOTICE) for attribution.

## Install

Requires dsh >= 0.1.1-rc.1.

```sh
dsh plugin --profile web add @eternalloveone/dsh-palm
```

Already-paired devices keep working after switching install sources.

## Highlights

- **Standalone `/m/` mobile UI** — an independent phone bundle, not a CSS-injected adaptation
- **Desktop-phone live sync** — one shared host event stream (measured: loopback 4 ms / public tunnel 9 ms / Tailscale 13 ms median)
- **SSE mux bridge with polling fallback** — stall detection (36 s) arms adaptive history polling; events are never lost
- **Windowed streaming renderer** — inline-markdown tail preview, no typewriter cursor, collapsible reasoning blocks
- **Interactive diff cards, code actions, command cards, realtime approval panels, image attach, voice transcription, plugin market**
- **PWA + offline outbox + gzip-compressed API responses** — weak-network friendly
- **Six-digit pairing code** — type a code on the phone instead of scanning
- **Three-step pairing wizard** — configure → pair → use, with tunnel detection (Tailscale one-click, frp entry from `frpc.toml`), reachability-checked saving, and a clean device-management view once paired
- **Workspace-native theming** — the panel follows the system light/dark scheme via `prefers-color-scheme`

Full feature list, measured data and architecture docs: see the [repository README](https://github.com/Eternalloveone/dsh-palm).

## Remote access setup

The desktop pairing panel (the phone icon in the sidebar) walks you through three steps: **configure → pair → use**. To reach this computer from your phone you need an address the phone can reach:

- **Same network** — start dsh web bound to your LAN address; the phone pairs over Wi-Fi with zero configuration.
- **Tailscale** — install Tailscale on this computer and your phone; the panel detects it and fills your tailnet address with one click.
- **Cloudflare Tunnel / frp** — run a tunnel to this machine and enter its public URL in the panel's public-address card. Saving verifies reachability first, so a dead tunnel is caught before it is persisted.

A full walkthrough with a worked frp topology (server frps + nginx TLS, client frpc, panel configuration, verification, and FAQ) lives in the [remote access guide](docs/remote-access-guide.md).

## License

Apache-2.0 — see [LICENSE](LICENSE).
