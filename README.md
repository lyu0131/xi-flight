# xi-flight

A ball cockpit flying over the real Earth, in the browser: a spherical panoramic monitor around an armoured-pod
seat, with Three.js and Takram's atmosphere and volumetric clouds (loaded from a CDN). The seat is lit by what the
monitor shows.

Live: https://lyu0131.github.io/xi-flight/

- Plain static site, no build step. It needs a network connection (the libraries and the clouds' data come from
  CDNs) and must be served over http (not opened as a file).
- Controls: the mouse steers, W/S throttle, A/D bank, Q/E yaw, Shift boost, right-drag or C looks round, M changes mode.
- `DESIGN.md` is the design contract; `docs/` holds the specs and plans.
- `tools/make_seat.py` builds and bakes the seat in Blender (it reads CC0 ambientCG texture sets from
  `tools/tex-src/`, not included; the sets are listed in its header).
- The tests (`tests/`) were written for the parent `neocities` repo's layout (they serve `site5/...`).
