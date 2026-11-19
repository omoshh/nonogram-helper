# Nonogram Helper

A small web app for black-and-white nonograms (Japanese crosswords) that you
solve on paper. Enter the clues once; the app solves the puzzle and keeps the
solution hidden. Later, enter your marks and ask for a check:

- **Mistakes** — first only the count, then rows and columns, then the exact
  cells. Each level needs a tap.
- **Hint** — the next cell that follows by logic, again one level at a time:
  where to look, which cells, and why.

Everything runs in the browser. Puzzles are stored only on your device; use
the backup export to keep a copy.

**App:** https://omoshh.github.io/nonogram-helper/

Works offline after the first visit. To install it on Android (Firefox):
menu ⋮ → *Add app to Home screen*.

Reading clues and marks from a photo is planned, not built yet.

## Development

```sh
npm install
npm test        # unit and component tests
npm run dev     # local dev server
npm run build   # production build in dist/
```

Pushes to `main` deploy to GitHub Pages.
