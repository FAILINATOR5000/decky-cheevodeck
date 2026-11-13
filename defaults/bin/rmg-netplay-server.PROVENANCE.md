# rmg-netplay-server: where this binary came from

`rmg-netplay-server` is the netplay server for RMG (Rosalie's Mupen GUI), by Rosalie241. Play Together starts it on the host's device for a Local N64 Couch room, so the other players' RMG can find a session on the same network. It runs as a separate process; nothing in CheevoDeck's own source links against it.

| | |
|---|---|
| Version | **v0.0.1** (x86-64 Linux) |
| Release | https://github.com/Rosalie241/rmg-netplay-server/releases/tag/v0.0.1 |
| Asset | `rmg-netplay-server-linux-amd64`, unmodified |
| Tag commit | `bf0f28746971fcb6341fac55c0d2d19f646a6e09` |
| Source at that commit | https://github.com/Rosalie241/rmg-netplay-server/tree/bf0f28746971fcb6341fac55c0d2d19f646a6e09 |
| sha256 (binary) | `ef38d1087a6ad7eadb0e7638b8f4fea01df9dd7b0b855e951d067c6d6aa7fcd1` |
| Built with | go1.26.3, `CGO_ENABLED=0`, by upstream's release workflow |
| License | GPL-3.0, full text in `rmg-netplay-server.COPYING` |
| Compiled-in code | the Go standard library and ten Go modules, listed with their license texts in `rmg-netplay-server.THIRD-PARTY.txt` |

GPLv3 wants the corresponding source available. For a Go program that is the server's own source plus the source of every module compiled into it, at the versions its `go.mod` and `go.sum` pin. The tag commit above is the server's source, and the module versions are recorded in the binary itself (`go version -m`). I also keep a copy of the complete source, the tagged tree with `go mod vendor` output, as `rmg-netplay-server-v0.0.1-vendored.tar.gz` (sha256 `3d324954650343df9eeedd4cbb746783969acc52ef310da8e2c2d826e59ee811`), and will send it to anyone who asks, for as long as this binary ships.

The x86-64 binary reports itself as `v0.0.1+dirty`: upstream's workflow builds every target in one checkout, and the ARM64 binary it writes first is not in `.gitignore`, so the x86-64 build sees an untracked file. The tracked source is the tag commit unchanged.
