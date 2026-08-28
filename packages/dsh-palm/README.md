# dsh-palm

**掌上 dsh** — the standalone mobile surface for the [dsh](https://github.com/deepseek-ai/deepseek-harness) web GUI: scan-to-pair device trust, the `/m/` phone UI, the `/m/api` RPC channel with a realtime SSE mux bridge, and a polished desktop pairing panel.

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

Full feature list, measured data and architecture docs: see the [repository README](https://github.com/Eternalloveone/dsh-palm).

## License

Apache-2.0 — see [LICENSE](LICENSE).
