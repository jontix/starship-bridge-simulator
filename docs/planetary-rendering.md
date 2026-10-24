# Planet Rendering — Physical scale and visual archetypes (prototype)

## Why this layer exists

Aster Reach has correct astronomical ephemerides and physical radii, but the
earlier 3D view showed **symbolic planet markers**. That made a 12,740-km
world and an 18-metre ship look similarly sized even while the ship was only
430 km above the planet. This milestone replaces those markers with physically
correct apparent-size planetary globes.

The **local ship/docking physics, cruise drive and orbital ephemerides are
unchanged**. This is a renderer architecture upgrade, not a change to collision
or thrust. Star System Map remains a deliberately logarithmic navigation chart.

## Rendering architecture

Babylon.js uses **two sequential scenes** on the same WebGL engine:

1. **Celestial background scene**: a distant deterministic starfield and all
   sun/planet/moon globes. Its camera is fixed at the origin but its *view
   orientation and field of view* match the main scene's camera. This scene
   clears colour and depth before rendering.
2. **Local scene**: existing Helm ship, station, beacons, velocity vector,
   cruise streaks and heading sphere. This scene clears depth but **does not
   clear colour**, so its close-range objects render correctly over the sky.

This deliberate two-pass separation prevents a projection-proxy planet from
falsely occluding a 300-metre-distant space station merely because the planet
mesh has been placed nearer to the camera for GPU precision.

### Angular size must remain exact

Given a body radius `R`, its distance from the camera `d`, and a stable
background-scene proxy distance `D = 8,000 m`:

```
actual angular radius = asin(R / d)
render proxy radius = D * (R / d)
proxy angular radius = asin(render proxy radius / D)
                     = actual angular radius
```

The camera is outside the body when `d > R`. Unlike a simple billboard or
artificially expanded planet icon, the proxy renders a *real spherical
perspective disc* with the same curvature and apparent horizon as its
true-radius physical body.

All distance computation happens in **metre-valued double precision**
using `shipPositionFromSnapshot`, `bodyPositionAt` and
`systemPositionsAt`. The renderer only transfers normalized bearing plus
an 8-km camera-relative proxy into 32-bit GPU geometry. We never submit
billion-kilometre scene coordinates to Babylon's vertex pipeline.

To avoid unnecessary meshes/textures for bodies smaller than two screen
pixels, the renderer uses an unresolved 1-pixel navigation glint (only while
navigation aids are shown). This point marker is explicitly symbolic and is
not used in physics or the resolved planetary view.

#### Haven at Highport

Haven radius: **6,370 km**. Haven Highport orbit: **6,800 km from centre**.
Approximate altitude: **430 km**. Thus the planet has an apparent angular
radius of about **69.5°** and angular diameter of about **139°**.
That globe can fill most of the sky—exactly what low orbit should look like.

## Appearance catalog and shader layers

Each celestial body can declare an optional reusable
`PlanetAppearance` preset, including the archetype, seed, axial tilt,
rotation period, and optional atmosphere/cloud structure.

Aster Reach defines:
- Aster: a bright rotating G-star surface
- Cinder: dry, rocky, iron/rust-coloured surface
- Haven: ocean world, polar regions, continents, city lights at night,
  independently moving clouds, and a blue atmospheric limb
- Selene: mottled airless grey satellite
- Bastion: textured rotating gas bands and storms
- Tundra: blue/cyan icy atmospheric bands

The surface generator uses **deterministic 3D fractal noise sampled on a
sphere**, avoiding the seam that 2D texture randomization often introduces.
Textures are generated locally in the browser and cached per body; there
is **no third-party texture download, licence risk or server dependency**.

Procedural assets are lazy-loaded only when the globe's apparent diameter
is large enough to resolve. The largest prototype base texture is 1536×768
(Haven); other bodies are 1024×512. This is a deliberate memory/performance
tradeoff until image/terrain LOD is implemented.

Custom Babylon shaders combine textured globe normals and each body's
actual star direction to show sunlight and a true day/night terminator.
Haven also has an ocean specular contribution and a city-light mask that
appears primarily on the night side. Clouds rotate slightly independently
of the surface, and an atmosphere shell contributes a light-dependent rim.

No full volumetric atmospheric scattering, surface bump tessellation,
surface landing physics, or high-resolution terrain yet. These would be
separate future upgrades.

## Camera and controls

Select **Planet / orbital panorama** in the camera dropdown (the first
default view) to aim at the associated world. The camera uses the selected
celestial object from **Planet / orbital camera focus**, or in automatic
mode follows the active cruise destination or current station's parent.

In low orbit, looking directly at the world centre fills the entire view
with surface colour and hides the horizon. The orbital camera deliberately
aims close to the **limb** when the angular radius is large, framing both
curvature and surrounding space. This changes only camera framing, not
the planet's scale or position.

Both Main Screen and Helm display the focused body's physical radius,
camera-independent distance from ship centre, surface altitude and
apparent angular diameter. Change the focus dropdown to inspect another
world without teleporting or changing Helm orders.

The other Orbit, Chase, Tactical and Local Sector camera modes continue to
function. Press **M** for the symbolic astronomical system map.

## Manual visual acceptance tests

1. Switch to branch `feature/planetary-rendering`, `npm install`, `npm run dev`.
2. Open Helm and Main Screen at `http://127.0.0.1:5173`.
3. Both begin with **Planet / orbital panorama**. At Haven Highport,
   Haven should be an enormous, curved, blue/clouded planet with atmosphere.
   The ship and orbiting station must remain visible **in front** of it.
4. Switch to Orbit and Local Sector cameras. Verify the globe changes
   apparent size only due to actual camera position/distance, not an
   arbitrary icon scale or zoom setting.
5. At Helm, use **M** and select Selene Observatory; engage cruise. The
   orbital sky must change continuously, with Haven shrinking into a disc
   and the Selene destination growing during approach.
6. Observe braking and arrival. The Moon should occupy the proper apparent
   size for the Selene Observatory orbital altitude.
7. Focus Aster, Cinder, Bastion, Tundra and Selene in the dropdown: each
   should use a different visual archetype.
8. Look for a day/night boundary as the star illuminates each sphere,
   city-light clusters on Haven's night side and cloud movement over time.
9. Toggle navigation aids: tiny distant unresolved points may disappear,
   but visible planetary discs must remain (physical objects, not overlays).
10. Set low FOV/orbit camera angles; the planet must not have 100-metre-scale
    parallax or clip through the vessel. Check the browser console for
    shader compilation or WebGL errors.
11. Return to the System Map: icon radii remain exaggerated and the map
    remains log-distance; it must not affect the correct-scale 3D renderer.

## Technical limitations and possible follow-up

- The projection proxy preserves angular diameter from a camera *outside*
  a planet; being physically inside the surface is not supported.
- Extremely close atmospheric entry and fully arbitrary huge interior
  sky geometry will require a terrain/atmosphere handoff.
- A separate background pass composites planets behind local geometry;
  foreground occlusion of planets by truly distant objects is not modeled.
- The sky follows the active local-camera bearing and position, but
  system-wide collision/occlusion between several planets is not yet modeled.
- The procedural texture generator is a first visual art style rather than
  NASA-quality photogrammetry. Later versions can supply authored textures,
  bump/specular/normal maps, ring meshes, shadows, clouds with lighting and
  atmosphere scattering, without changing the catalog or physics interfaces.

## Verification

`npm run build && npm test` includes pure angular-geometry and orbital focus
checks alongside existing 6DOF, universe and cruise tests. CI also smoke-tests
both server/client protocols on Node 22 (Linux) and Node 24 (Windows).
The final visual/camera check must still be performed interactively.
