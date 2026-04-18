# Recording the demo GIF for the README

A ~30-second GIF at the top of the README is the single biggest resume-signal
polish item (most recruiters won't clone the repo; they'll watch the GIF and
click the live URL). Record it once M9 is done, not before.

## What to show (in order, ~30s total)

1. **Home (~3s).** Cursor hovers over config picker. Click "create race".
2. **Waiting lobby (~3s).** Show the share link getting auto-selected. Copy it.
3. **Second tab opens the link (~2s).** Countdown 3-2-1-GO pops on both sides.
4. **Race (~15s).** Both cursors typing, opponent pink cursor tracking live,
   WPM counters ticking on each side. End on someone finishing.
5. **End screen (~5s).** Win/lose banner, WPM graph, rematch button.
6. **Loop.**

Keep the two windows side-by-side so a viewer can see "input → remote sync"
in one frame.

## Tools

- **Windows:** ScreenToGif (free, direct GIF export) — https://www.screentogif.com/
- **Mac:** Kap (free) — https://getkap.co/
- **Linux:** Peek

Target: <5 MB GIF, <60 seconds, 720p max width. GitHub renders inline in the README.

## Where to put it

1. Drop the file at `docs/demo.gif`.
2. Replace the HTML comment near the top of `README.md` with:
   ```md
   ![typing-race demo](./docs/demo.gif)
   ```
3. Commit and push.

## Mini-alternative until you have two devices together

Use two browser windows tiled on one screen. It's obviously not as compelling
as phone+laptop, but it still communicates the idea.
