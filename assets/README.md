# Brand artwork

Two files, both COPIED byte for byte out of the Credda brand folder
(`packages/design/brand/` in the engine repository). Nothing here is drawn,
resized, recolored or composited in this repository.

| File | What it is |
| --- | --- |
| `credda-lockup-black.png` | The lockup in black, 2121x447, for a **light** background. |
| `credda-lockup-white.png` | The lockup in white, 2121x447, for a **dark** background. |

They replace `creddaseallockup{light,dark}transparent.png`, the retired orange
and blue Seal lockups. **The identity is achromatic**: there is no brand hue,
and the pair is named for the job it does — black-on-light, white-on-dark —
rather than for a colour, because a filename with a hue in it has to be
rewritten every time the hue changes, which it has.

The lockup is the wordmark first and the mark after it, with no rule and no
divider between them: two shapes at the same ink height meeting at a single
pinch. It is the form to reach for anywhere wide and horizontal, which is what
a README header is. The mark never appears on its own here.

The mark is the **Seal**: a thick ring with five short notches cut into one
side, a run down the lower left and the rest of the rim smooth. An append-only
record where every defect Credda reproduced, diagnosed, patched and proved is a
notch cut into the same seal, and the one clean gap is where the next one goes.

Its rotational symmetry is broken on purpose. Twelve evenly spaced notches with
one gap is a cog, and a cog says "machinery", which is the opposite of the
claim.

## Rules

**Never hand-edit these.** They are generated output in the brand folder. To
change them, change the masters there and copy the result across again.

**Do not re-compose the lockup from the wordmark and the mark.** The gap between
them is 0.26 of the mark's ink width, measured ink edge to ink edge, and it is
baked into these files.

**Copy the pixels, do not composite them.** Pasting an RGBA image using itself
as a mask blends every partially transparent pixel toward the empty canvas, so
each antialiased edge darkens. The artwork looks identical and is not. Verify a
copy by hashing the file, not by looking at it:

```
shasum -a 256 assets/credda-lockup-*.png
3633802f84abf8e694230f91d782e6c60f5d99f88d88f5dc5ba7d0db2ce10f56  credda-lockup-black.png
18b61c8c5563e46cd3acac07124d60f93f3898fbba919cc04fd02968470c175f  credda-lockup-white.png
```

## Why they are committed here rather than linked from elsewhere

The README is rendered on GitHub and, for the published package, on the npm
registry page, where a relative image path does not resolve. So the tags use
absolute `raw.githubusercontent.com` URLs, and the files they point at have to
live in this repository for that URL to exist. They are not shipped to any
registry: `package.json`'s `files` list covers `dist` only, and a registry
tarball carries just the README, the license and the manifest alongside it.
