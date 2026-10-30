# Vendored test font

The browser regression lane renders with exactly one pinned font so pixel probes do not depend on
whatever fonts the CI image or a developer machine happens to have.

| Field        | Value                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File         | `DejaVuSansMono.ttf` (DejaVu Sans Mono, style Book, `fontversion` 155320)                                                                                  |
| Source       | Debian/Ubuntu package `fonts-dejavu-core` 2.37-2build1 (`/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf`); upstream <https://dejavu-fonts.github.io/> |
| SHA-256      | `39c29931201f08dd89fdba4129c76288e6baeecf7c94fe4f6a757f2b50718b1b`                                                                                         |
| Size         | 340,712 bytes                                                                                                                                              |
| Licence      | Bitstream Vera licence + public-domain DejaVu changes; full text in [`LICENSE`](LICENSE) (copied verbatim from the package's `copyright` file)             |
| Metrics used | `unitsPerEm` 2048, advance 1233 units (9.0308 px at 15 px)                                                                                                 |

`font.json` is the machine-readable lock read by `../harness.ts`. The harness:

1. fetches the file and **verifies its SHA-256** before use;
2. registers it under the unique family name `GhosttyRegressionMono` (not "DejaVu Sans Mono"), so an
   installed system copy can never silently stand in for a failed load;
3. requires `FontFace.status === 'loaded'`, `document.fonts.check()` and a measured advance of `M`
   matching the table metrics.

Any failure rejects harness readiness with `FONT_NOT_LOADED`; nothing falls back. Do not replace the
file without updating `font.json`, this README and re-reviewing every pixel expectation.
