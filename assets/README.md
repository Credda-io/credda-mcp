# Brand artwork

Three files, all COPIED byte for byte out of the Credda brand folder
(`packages/design/brand/` in the engine repository). Nothing here is drawn,
resized, recolored or composited in this repository.

| File | What it is |
| --- | --- |
| `credda-mark-spectrum.png` | The Seal alone, swept in the six brand colours, transparent, 830x830. **The header, and the only file this README references.** |
| `credda-lockup-black.png` | The lockup in black, 2121x447. Retired here; still on disk. |
| `credda-lockup-white.png` | The lockup in white, 2121x447. Retired here; still on disk. |

The mark is the **Seal**: a thick ring with five short notches cut into one
side, a run down the lower left and the rest of the rim smooth. An append-only
record where every defect Credda reproduced, diagnosed, patched and proved is a
notch cut into the same seal, and the one clean gap is where the next one goes.
Its rotational symmetry is broken on purpose — twelve evenly spaced notches with
one gap is a cog, and a cog says "machinery", which is the opposite of the
claim.

## The identity is the spectrum now

Until 2026-08-29 this file said in bold that **the identity is achromatic**,
that there is no brand hue, and that the black/white pair was named for the job
rather than for a colour. The first of those three is no longer true. Since
`870d264` in `web`, `components/brand/Seal.tsx` makes `spectrum` the **default**
tone rather than something a caller opts into, and records that the earlier rule
reserving the sweep for four named large marks is superseded. credda.io carries
it on every mark; api.credda.io was moved to match hours before this change; and
these mirror repositories were the last public front pages left on the retired
achromatic mark.

**The widening is of where the palette may appear, not of what it may say.** The
sweep is legal only as a continuous six-stop field across an identity asset —
the brand saying its own name — and never as a swatch, never as ink, and never
as or beside a verdict. Four of its six stops sit inside the state-family
separation floor of a dark state foreground, so that is a measured collision and
not a theoretical one. Every outcome still comes from the state families
(ADR 0011), and nothing on this page states one anywhere near the header.

## Why the mark rather than a lockup, and why one file

**There is no spectrum lockup.** `credda-lockup-mesh.png` in the brand folder is
the older mesh treatment, scoped to social cards, and is a different set from
the spectrum one — the icon files prove it, since the mesh and spectrum squares
do not hash equal. So keeping the lockup form meant generating a raster, which
is image editing that no diff can review. api.credda.io reached the same wall
and composed instead: the spectrum tile beside a text wordmark. Here the
composition is the mark above the `# @credda/mcp-server` heading, which carries
the name in text a reader can select, resize and have read aloud — which the
wordmark half of a raster never could. The mark's `alt` is `Credda`.

**The loose mark is the right variant at this size.** `BrandMark.tsx` swaps in
the square icon only below 32px, where the notches stop resolving and the ring
reads as a plain circle. The header renders at 96px.

**And it needs no pair.** The lockups were a pair because each is invisible on
the other's ground; the spectrum mark is not, so there is no `<picture>` and no
media query in the header at all. That is worth more in a README than on a web
page: GitHub honours `prefers-color-scheme`, the npm registry page renders this
same file and may not, and a themed pair whose query is ignored shows the wrong
ground. A transparent mark has no wrong ground. Measured over every fully opaque
pixel of the master, the weakest stop holds **1.81:1** on white and **4.53:1**
on GitHub's dark `#0d1117`; medians 3.28:1 and 5.77:1. The yellow does not read
on white — the same fact that made the design package drop yellow from the
wordmark sweep — so the light figure is below the 3:1 a non-text graphic would
owe if it owed one. A brand mark does not; WCAG 1.4.11 exempts a logo. Recorded
here rather than discovered later. The flat pair measured 19.13:1 and 19.80:1.

## The lockups are not deleted

They are unreferenced and they stay. An unreferenced published asset is still
somebody's downloaded asset — these files' `raw.githubusercontent.com` URLs have
been live on this branch — and a 404 breaks their page rather than ours. The
same reasoning is recorded in `credda-backend/src/public/router.ts` for the ink
icons.

## Rules

**Never hand-edit these.** They are generated output in the brand folder. To
change them, change the masters there and copy the result across again.

**Do not recolour or redraw the mark, and do not touch the notches.** Five down
the lower-left rim, the sixth position left clean. Adding one, respacing the run
or balancing it makes a different mark that means something else.

**Copy the pixels, do not composite them.** Pasting an RGBA image using itself
as a mask blends every partially transparent pixel toward the empty canvas, so
each antialiased edge darkens. The artwork looks identical and is not. Verify a
copy by hashing the file, not by looking at it:

```
shasum -a 256 assets/*.png
be33c109f9c375959239a07ac8f03bbef3372692531fdb2b647745cbd742ef04  credda-mark-spectrum.png
3633802f84abf8e694230f91d782e6c60f5d99f88d88f5dc5ba7d0db2ce10f56  credda-lockup-black.png
18b61c8c5563e46cd3acac07124d60f93f3898fbba919cc04fd02968470c175f  credda-lockup-white.png
```

## Why they are committed here rather than linked from elsewhere

The README is rendered on GitHub and, for the published package, on the npm
registry page, where a relative image path does not resolve. So the header uses
an absolute `raw.githubusercontent.com` URL, and the file it points at has to
live in this repository for that URL to exist. They are not shipped to any
registry: `package.json`'s `files` list covers `dist` only, and a registry
tarball carries just the README, the license and the manifest alongside it.
