# dsh-palm

[简体中文](README.md) | [English](README.en.md)

The [dsh](https://github.com/deepseek-ai/deepseek-harness) desktop surface, on your phone. Same sessions, same progress: check status, reply, approve, tidy up. Complex configuration stays on the desktop.

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
| Reply | Text, camera, files, voice input; queue a message while a turn runs, edit it before sending |
| Approve | Tool approvals and questions arrive in real time; answers bind to the requesting device |
| Manage sessions | Long-press to pin / rename / delete; search jumps to the matched message |
| Get notified | WeChat (WxPusher / ServerChan), iOS (Bark), Telegram, or Web Push |
| Change the look | 19 skins, plus your own photo as wallpaper |

Full list: [capabilities](docs/capabilities.md).

## Requirements

| Item | Value |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0-0` |
| Node | `^22.19.0` or `>=24.0.0` |
| Phone | Android Chrome/Edge/Firefox; iOS Safari installed to the home screen |

Phone and host upgrade independently — neither side breaks the other. Version matrix: [COMPATIBILITY.md](COMPATIBILITY.md). Upgrade notes: [UPGRADING.md](UPGRADING.md).

## More

- [Documentation index](docs/README.md) · [Notifications](docs/notifications.md) · [Remote access](docs/remote-access.md)
- [Releasing](RELEASING.md)
- A derivative work of [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) (Apache-2.0); the UI and the API are rewritten. See [NOTICE](packages/dsh-palm/NOTICE)
- Licensed [Apache-2.0](LICENSE)
