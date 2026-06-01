# Now Playing

A GNOME Shell extension starter for controlling media playback from the panel.

## Development

### Prerequisites

- [Bun](https://bun.sh)
- GNOME Shell 49 or 50

### Setup & build

```sh
bun install       # optional; `make` will install if needed
make              # compiles TypeScript and copies assets into dist/
```

- `bun run build` — compile TypeScript to `dist/`
- `bun run lint` — lint source
- `bun run typecheck` — typecheck without emitting

### Local install & testing

```sh
make install      # builds, packs nowplaying@ztluwu.dev.zip, installs with gnome-extensions
```

Restart the shell (**Alt+F2**, type `restart`, Enter) so changes load. Enable **Now Playing** in Extensions.

### Packaging

```sh
make clean && make pack
```

Produces `nowplaying@ztluwu.dev.zip` in the project root.

### Clean

```sh
make clean
```
