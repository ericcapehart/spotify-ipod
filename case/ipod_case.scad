// iPod Classic case for the Samsung Galaxy S5 (SM-G900), running the iPod app.
//
// Two parts:
//   case  - front shell: faceplate with the iPod screen window and click-wheel well, plus the side
//           walls. The phone drops in from the back.
//   back  - plate that slides into a groove from the bottom end and holds the phone in.
// Plus "fit_test": just the faceplate and 3 mm of wall, a quick print to check alignment first.
//
// Pick a part in OpenSCAD's Customizer (Window > Customizer), or from the command line:
//   openscad -D 'part="case"' -o case.stl ipod_case.scad
// Exported parts are already in print orientation (case face-down, back plate outside-down).
//
// Units are millimetres. Phone positions are measured from the phone's top-left corner, looking at
// the screen. The iPod layout must match the "body.in-app" block in ../style.css.

/* [Part] */
part = "assembly"; // [assembly, case, back, fit_test]

/* [Phone: Samsung Galaxy S5] */
phone_w = 72.5;
phone_h = 142.0;
phone_t = 8.1;
phone_r = 9.0;      // corner radius, seen from the front
disp_w = 63.5;      // active display area (1080 x 1920 px at 432 ppi)
disp_h = 112.9;
disp_left = 4.5;    // display's top-left corner from the phone's top-left corner
disp_top = 15.0;    // estimated: check with the fit test

/* [iPod layout on the display (matches style.css)] */
lcd_w = 54;         // screen window; the app draws 1 mm more on each side
lcd_h = 40.5;
lcd_top = 6;        // from the top of the display
lcd_r = 1.5;
wheel_d = 47;       // wheel opening; the app draws a 49 mm wheel
wheel_cy = 78.5;    // wheel centre, from the top of the display

/* [Openings] */
sensor_w = 44;      // earpiece, front camera and sensors, across the top of the face
sensor_h = 6;
sensor_cy = 7.5;
home_w = 20;        // home button
home_h = 8;
home_cy = 135;
vol_cy = 40;        // volume rocker, left side
vol_len = 30;
power_cy = 40;      // power button, right side
power_len = 22;
top_port_w = 50;    // headphone jack, IR blaster and mic, top edge
bottom_port_w = 40; // USB port (and its flap) and mic, bottom edge
cam_w = 16;         // rear camera, flash and heart-rate sensor
cam_h = 32;
cam_top = 7;
speaker_w = 18;     // rear speaker
speaker_h = 5;
speaker_cy = 133;

/* [Case] */
gap = 0.3;          // clearance around the phone
wall = 2.0;
face_t = 1.8;       // faceplate thickness
lip_t = 1.0;        // rim behind the back plate
groove_h = 1.8;     // slot the back plate slides in
groove_d = 1.0;     // how far the slot cuts into the walls
plate_clear = 0.2;  // back plate clearance in its slot
well_depth = 1.2;   // bevel around the wheel opening, so the thumb finds the edge
window_chamfer = 0.6;

$fn = 96;

in_w = phone_w + 2 * gap;
in_h = phone_h + 2 * gap;
in_r = phone_r + gap;
out_w = in_w + 2 * wall;
out_h = in_h + 2 * wall;
out_r = in_r + wall;

// Heights, with the case lying on its back (faceplate on top).
z_gr0 = lip_t;
z_gr1 = lip_t + groove_h;
z_ph0 = z_gr1;
z_ph1 = z_ph0 + phone_t + gap;
z_face0 = z_ph1;
H = z_face0 + face_t;

// A phone position (from its top-left corner, front view) -> case coordinates (origin at centre).
function fx(x) = x - phone_w / 2;
function fy(y) = phone_h / 2 - y;

// Rounded rectangle; with r >= half the short side it becomes a capsule.
module rrect(w, h, r) {
    r2 = min(r, w / 2, h / 2);
    hull() for (sx = [-1, 1], sy = [-1, 1]) translate([sx * (w / 2 - r2), sy * (h / 2 - r2)]) circle(r2);
}

module slab(z0, z1) {
    translate([0, 0, z0]) linear_extrude(z1 - z0) children();
}

// The back plate's slot: the inner outline grown by groove_d, with straight sides running out
// through the bottom end so the plate can slide in.
module groove2d() {
    hull() {
        rrect(in_w + 2 * groove_d, in_h + 2 * groove_d, in_r + groove_d);
        translate([0, -out_h / 2 - 1]) square([in_w + 2 * groove_d, 2], center = true);
    }
}

module window(w, h, r, c) {
    slab(z_face0 - 1, H + 1) rrect(w, h, r);
    hull() {
        slab(H - c, H - c + 0.01) rrect(w, h, r);
        slab(H, H + 0.01) rrect(w + 2 * c, h + 2 * c, r + c);
    }
}

module face_openings() {
    cx = fx(disp_left + disp_w / 2);
    translate([cx, fy(disp_top + lcd_top + lcd_h / 2)]) window(lcd_w, lcd_h, lcd_r, window_chamfer);
    translate([cx, fy(disp_top + wheel_cy)]) {
        translate([0, 0, z_face0 - 1]) cylinder(d = wheel_d, h = face_t + 2);
        translate([0, 0, H - well_depth]) cylinder(d1 = wheel_d, d2 = wheel_d + 2 * well_depth, h = well_depth + 0.01);
    }
    translate([0, fy(sensor_cy)]) slab(z_face0 - 1, H + 1) rrect(sensor_w, sensor_h, sensor_h / 2);
    translate([0, fy(home_cy)]) slab(z_face0 - 1, H + 1) rrect(home_w, home_h, home_h / 2);
}

// Slot through a long side wall, running along the phone.
module side_slot(len, z0, z1) {
    translate([0, 0, (z0 + z1) / 2]) rotate([0, 90, 0])
        linear_extrude(wall * 3, center = true) rrect(z1 - z0, len, (z1 - z0) / 2);
}

// Slot through the top or bottom wall, running across the phone.
module end_slot(w, z0, z1) {
    translate([0, 0, (z0 + z1) / 2]) rotate([90, 0, 0])
        linear_extrude(wall * 3, center = true) rrect(w, z1 - z0, (z1 - z0) / 2);
}

module edge_openings() {
    zb0 = z_ph0 + 1.5; // the side buttons sit around mid-thickness
    zb1 = z_ph1 - 1.0;
    translate([-out_w / 2, fy(vol_cy)]) side_slot(vol_len, zb0, zb1);
    translate([out_w / 2, fy(power_cy)]) side_slot(power_len, zb0, zb1);
    translate([0, out_h / 2]) end_slot(top_port_w, z_ph0 + 1.0, z_ph1 - 1.0);
    translate([0, -out_h / 2]) end_slot(bottom_port_w, z_ph0 + 0.5, z_ph1 - 1.0);
}

module case_body() {
    difference() {
        slab(0, H) rrect(out_w, out_h, out_r);
        slab(-1, z_face0) rrect(in_w, in_h, in_r); // phone cavity; it goes in from the back
        slab(z_gr0, z_gr1) groove2d();
        face_openings();
        edge_openings();
    }
}

module back_plate() {
    t = groove_h - 0.3;
    difference() {
        translate([0, 0, z_gr0 + 0.15]) linear_extrude(t) intersection() {
            offset(-plate_clear) groove2d();
            rrect(out_w, out_h, out_r); // flush with the outside at the bottom end
        }
        // Centred openings, so they line up the same when seen from the back.
        translate([0, fy(cam_top + cam_h / 2), -1]) linear_extrude(10) rrect(cam_w, cam_h, 3);
        translate([0, fy(speaker_cy), -1]) linear_extrude(10) rrect(speaker_w, speaker_h, speaker_h / 2);
        translate([0, -out_h / 2, -1]) cylinder(r = 6, h = 10); // finger notch for sliding it out
    }
}

module phone_ghost() {
    color("DimGray", 0.35) slab(z_ph0, z_ph0 + phone_t) rrect(phone_w, phone_h, phone_r);
    color("SteelBlue", 0.5) translate([fx(disp_left + disp_w / 2), fy(disp_top + disp_h / 2)])
        slab(z_ph0 + phone_t - 0.1, z_ph0 + phone_t) square([disp_w, disp_h], center = true);
}

module face_down() {
    rotate([180, 0, 0]) translate([0, 0, -H]) children();
}

if (part == "case") {
    face_down() case_body();
} else if (part == "back") {
    translate([0, 0, -(z_gr0 + 0.15)]) back_plate();
} else if (part == "fit_test") {
    intersection() {
        face_down() case_body();
        slab(0, face_t + 3) square([out_w + 2, out_h + 2], center = true);
    }
} else {
    color("Gainsboro") case_body();
    color("Silver") back_plate();
    phone_ghost();
}
