# iPod case for the Galaxy S5

A two-piece 3D-printed case that covers the S5's screen except for the iPod screen and click wheel.
It's designed for the iPod Android app, which draws its screen and wheel at the exact positions of
the case openings.

| File | What it is | Print time (rough) |
|---|---|---|
| `stl/ipod_fit_test.stl` | Faceplate plus 3 mm of wall. **Print this first** to check alignment | ~30 min |
| `stl/ipod_case.stl` | Front shell: faceplate, screen window, wheel well, side walls | ~3 h |
| `stl/ipod_back.stl` | Back plate that slides in from the bottom and holds the phone | ~45 min |
| `ipod_case.scad` | The OpenSCAD source. Every measurement is a named setting at the top | |

## Printing

- **Material:** PLA or PETG. PETG is a bit tougher for something that lives in a pocket.
- **Orientation:** as exported. The case prints face-down, so the front gets the smooth (or textured)
  finish of the build plate. The back plate prints flat.
- **Settings:** 0.2 mm layers, 3 walls, 15–20% infill. **No supports needed.** The side slots bridge
  up to 50 mm, which most printers handle. If they sag, turn on supports for those slots only.

## Fitting

1. Print the **fit test**, open the iPod app, and lay the test piece over the phone.
2. Check that the iPod screen and wheel sit evenly inside the openings, and that the sensor slot and
   home button line up. If something's off, measure how far and in which direction. The main setting
   to adjust is `disp_top`: where the display starts below the top of the phone. It's an estimate.
3. Once it fits, print the case and back plate. Drop the phone in from the back, face-first, then
   slide the back plate in from the bottom end until it's flush.

## Adjusting

Open `ipod_case.scad` in OpenSCAD, change the settings in the Customizer (Window › Customizer),
and export with File › Export › STL. Or from the command line:

```bash
openscad -D 'part="case"' -o stl/ipod_case.stl ipod_case.scad
```

If you move the **screen window or wheel**, change the matching values in the `body.in-app` block
of `../style.css` too, and rebuild the app. The app draws everything 1 mm larger on each side than
the openings, so small misalignments stay hidden behind the case edge.

The S5's capacitive Recent and Back keys, on either side of the home button, are covered. The
iPod's MENU button does the same job as Back.
