# App icons

Tauri needs real icon binaries here (`32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns`, `icon.ico`) — they are **not** committed because
they are generated, not authored.

Generate them from the existing Verba icon on a machine with the Tauri CLI:

```sh
# from apps/macos/
npm run tauri icon ../../images/icon.png
```

This populates `src-tauri/icons/` with all required sizes. The paths must match
`bundle.icon` in `tauri.conf.json`.
