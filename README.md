# Traces GPX (GPX tracks, `.gpx`)

> One of the example extensions of [Filarr Builder](https://github.com/filarr-work/filarr-extension-builder), published as its own
> repository. Its source of truth is [`examples/code/traces-gpx`](https://github.com/filarr-work/filarr-extension-builder/tree/main/examples/code/traces-gpx).

Opens a hiking, running or cycling track: elevation profile, distance, elevation
gain and loss, and segments you can rename.

## What the example shows

**A Web Worker created from a `blob:`** (`src/calculateur.ts`). The sandbox
page's CSP allows only one worker source: `worker-src blob:`. The build compiles
`src/calcul.worker.ts` separately and imports it as text
(`import source from './calcul.worker.ts?worker'`, built by `filarr-ext build`); the
editor turns it into a `Blob`, then a `Worker`. The worker inherits the CSP — no
network, no remote `importScripts`: it moves the computation off the main
thread, nothing more. It is an optimization, not a requirement: without
`Worker`, or if the worker fails, the same computation runs on the main thread.
On `destroy()`, the worker is terminated **and** the `blob:` URL revoked.

**Three pure functions** (`src/fonctions.ts`), which Filarr calls without opening
the editor, in a page with no API at all:

| Function | What Filarr does with it |
| --- | --- |
| `thumbnail` | the file's card shows the profile (192 × 96 PNG, ~18 KiB) |
| `fields` | the table view of a folder of tracks shows `distance_km` and `denivele_m` — Filarr builds the table, the extension never sees the folder |
| `extractText` | search finds the track by its name and the names of its segments |

`fields` values are converted to the type declared in the manifest (`number`); a
track without elevation returns `denivele_m: null`, never a made-up zero.

**Surgical rewriting of a third-party format** (`src/gpx.ts`). A GPX file often
carries watch data (heart rate, cadence…) in its `<extensions>`. As long as no
name has changed, the editor returns the original bytes **unchanged**. When you
rename a segment, only its `<name>` is modified (created at the top of the
`<trk>`, in the file's namespace, if it was missing); points, times and
extensions pass through as they are.

**An accessible chart** (`src/graphique.ts`): the profile is a slider
(`role="slider"`) — arrow keys, Page Up/Page Down, Home/End move along the track,
and the screen reader reads "4.57 km, elevation 2,050 m". Its colors are Filarr
theme variables: it follows a theme change without redrawing anything.

The numbers: distance by haversine; elevation gain and loss filtered by a 3 m
hysteresis threshold (GPS altitude jitter does not inflate the total); nothing is
counted **between** two disjoint segments.

## Capabilities

```json
"capabilities": {
  "functions": {
    "extractText": true,
    "thumbnail": true,
    "fields": [
      { "key": "distance_km", "label": "Distance (km)", "type": "number" },
      { "key": "denivele_m", "label": "Dénivelé positif (m)", "type": "number" }
    ]
  }
}
```

The Web Worker requires **no** capability: it is part of the page's tier 1, open
to all extensions.

## A segment is a `<trk>`

GPX 1.1 can name a `<trk>`, not a `<trkseg>` (a break in the signal). So a
segment in the editor is a `<trk>`; its `<trkseg>` elements form a single
segment.

## Build and check

```bash
npm install
npm run build && npm run check && npm run smoke && npm test
```

The format tests run under jsdom (`// @vitest-environment jsdom`): the sandbox
page has `DOMParser`, Node does not.

## The files

```
src/index.ts          mount(), the wiring
src/gpx.ts            read the GPX, rewrite the names (DOMParser)
src/profil.ts         distance, elevation, profile (pure, no DOM: runs in the worker)
src/calcul.worker.ts  the worker
src/calculateur.ts    the worker from a blob:, and its fallback
src/fonctions.ts      thumbnail, fields, text — the pure functions
src/graphique.ts      the profile as SVG, navigable by keyboard
src/png.ts            the PNG encoder (pure)
exemples/             a hike in three segments, a run with heart rate
                      and a GPS dropout, a bike ride in GPX 1.0 without elevation
```

## Package and publish

```bash
npm run pack   # dist/traces-gpx-0.1.1.filarrext
```

Drop the package in Filarr › **Marketplace** › **Publish**: Filarr shows everything that will become
public, then signs it on your device. The tools never ask for a password or a key.
