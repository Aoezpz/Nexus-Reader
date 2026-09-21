# Vendored fonts

All three faces are bundled rather than linked, because the app has **no
network at first paint** and a CSP of `default-src 'self'` — with no `font-src`
of its own, so fonts fall back to `'self'`. A `<link>` to `fonts.googleapis.com`
would be blocked outright and every heading would silently render in the
fallback stack.

They are the server website's own stack (Cinzel, IBM Plex Sans, IBM Plex Mono),
so the app and tscemu.com read as one thing.

| File | Face | Subset | Source |
|---|---|---|---|
| `cinzel-700-latin.woff2` | Cinzel 700 | latin | Google Fonts, Cinzel v26 |
| `ibm-plex-sans-var-latin.woff2` | IBM Plex Sans 100–700 variable | latin | Google Fonts, IBM Plex Sans v23 |
| `ibm-plex-sans-var-latin-ext.woff2` | IBM Plex Sans 100–700 variable | latin-ext | Google Fonts, IBM Plex Sans v23 |
| `ibm-plex-mono-400-latin.woff2` | IBM Plex Mono 400 | latin | Google Fonts, IBM Plex Mono v20 |
| `ibm-plex-mono-500-latin.woff2` | IBM Plex Mono 500 | latin | Google Fonts, IBM Plex Mono v20 |

Plex Sans ships as one variable file covering the whole weight axis — Google
Fonts serves the identical URL for the 400, 500, 600 and 700 requests — so every
weight the app uses costs one download. Plex Mono is two static weights; it
never sets a character name, so it has no latin-ext file.

Only the Latin subsets are here. A glyph outside them (Cyrillic, Greek, CJK)
falls through to the next family in the stack automatically, which is the right
outcome for a character name the font cannot draw.

## Licence

All three are SIL Open Font License 1.1 — see `Cinzel-OFL.txt` and
`IBM-Plex-OFL.txt`, which ship with the app. The OFL permits bundling in an
application; it requires that the licence travel with the font, which is what
those files are for.

- Cinzel — Copyright 2020 The Cinzel Project Authors, https://github.com/NDISCOVER/Cinzel
- IBM Plex — Copyright © 2017 IBM Corp. with Reserved Font Name "Plex", https://github.com/IBM/plex

## Refreshing

Ask the Google Fonts CSS API with a Chrome user agent (an older UA gets you
`woff`/`ttf` instead of `woff2`), then pull the URLs it names:

```
https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap
```

Take the `/* latin */` and `/* latin-ext */` blocks and ignore the rest.
