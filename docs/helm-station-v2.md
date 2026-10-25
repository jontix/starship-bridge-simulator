# Helm Station v2 — Game-First Bridge Workstation

Status: first playable Helm console prototype, implemented on
`feature/helm-station-v2`. Built on the merged `main` milestone with
Babylon.js, Colyseus authoritative flight and interplanetary cruise intact.

## Implementation plan / completed scope

### Phase 1 — the bridge screen (this PR)

| Area | Components/files | Behaviour |
|---|---|---|
| Main station | `HelmPanel.tsx`, `helmStation.css` | Full-screen, 3-zone workstation and always-visible bottom telemetry instead of a single long scrolling panel |
| Navigation | `HelmWidgets.tsx`, `helmInstruments.ts` | Interactive bearing dial with selected, ordered, actual bow and inertial velocity markers; compact yaw/pitch/roll steppers and 3D heading sphere |
| Helm orders | `HelmPanel.tsx` | Separate draft heading, speed and lateral/vertical commands with explicit Engage buttons; impulse presets, axis pad and emergency braking |
| Situational panel | `HelmPanel.tsx`, existing `CruisePanel.tsx` | Mode, target, reference body, range/ETA, local drift, beacon contacts; FTL planner in a secondary tab |
| Display setup | `HelmPanel.tsx`, `PlanetReadout.tsx` | Camera/planet visuals moved under advanced settings; controls remain functional |
| Game scene | `main.tsx`, `scene.tsx`, `navigationVisuals.ts` | Helm opens into orbit camera with interactive heading sphere and local aids; the real Babylon 3D view remains clickable through the HUD |
| Testing | `helmInstruments.test.ts`, `smoke-planet-browser.mjs` | Angular wrapping, ship-relative velocity, command limits, preview-versus-send and real-server browser controls |

### Phase 2 — instruments and navigation helpers (future PR)

- Improved attitude and target-relative vectors with a dedicated local target selection.
- Relative approach speed and stopping distance estimates where grounded in
  the server simulation.
- Intercept and arrival cues tied to Sensors and helm navigation data.
- Gamepad/keyboard accessibility and station-player usability testing.
- **No promise of target-velocity matching until the authoritative simulation
  provides a properly defined target-frame command.**

### Phase 3 — docking / formation (future gameplay)

- Docking clearances and maneuver constraints in partnership with sensors,
  engineering and station traffic control.
- Formation holding and escort intent commands only after server-side
  physics and multiplayer authority are implemented.
- Scenario-driven UI feedback, alerts and meaningful crew cooperation.

## Bridge design principles

1. **Glanceable.** The primary attitude order, actual velocity, drive mode,
   drift and emergency brake remain visible while playing.
2. **Intent-driven.** Selecting a course on the 2D dial or 3D sphere changes
   a *draft*. Only Engage Heading sends a server command. Speed presets
   likewise prepare an order; Engage Speed transmits it.
3. **Ship-relative and world-relative vectors are distinct.** The radar dial
   represents global yaw/bearing; the body-frame strafe/lift controller is
   explicitly labelled +X starboard, +Y dorsal, +Z forward. Real world speed
   and off-axis drift are shown separately from ordered forward speed.
4. **Authoritative game data.** The station receives the same Colyseus
   snapshots as Main Screen. No ship physics, rotation or position is
   computed from interface inputs.
5. **Never mislead the player.** "Zero trim preview" sets *pending* lateral
   commands to zero; it does not claim to cancel world velocity or match a
   target frame. Emergency braking is acceleration-limited by the server.
6. **Strong visual hierarchy.** Navigation left, interactive 3D scene centre,
   impulse maneuver orders below it, drive/situation right, status strip
   across the bottom. Expanded display controls are secondary.
7. **Input and accessibility.** The dial supports pointer selection and
   arrow-key bearing edits; every command has a labelled button. Input
   disabled states reflect connection and local/FTL drive availability.

## Current supported wire protocol (unchanged)

```ts
{ type: "set_heading", yaw: number, pitch: number, roll: number }
{ type: "set_speed", speed: number } // m/s, [0,300]
{ type: "set_translation", strafe: number, lift: number } // m/s [-60,60]
{ type: "emergency_stop" }
```

These remain under the `helm_command` room message, validated by Zod on
the server. Interplanetary cruise continues to use existing
`cruise_command` messages. FTL mode locks local impulse commands; use
the FTL Planner to request a controlled drop.

The interface is a **flight computer control console**, not a fighter
cockpit or instantaneous-velocity teleport.

## Running locally (Windows PowerShell)

```powershell
cd C:\Users\jonti\bridgesim\starship-bridge-simulator
git fetch origin
git switch --track origin/feature/helm-station-v2
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`, select **Helm** in the Station chooser.

### Play test

1. Verify the screen has navigation/radar to the left, clickable 3D
   heading globe in the middle, command cards and situation to the right.
   Important motion data and **Emergency Brake** should be continuously
   visible at desktop resolutions, with no full-page scrolling.
2. Click a bearing on the round compass. The readout should say
   **PREVIEW ONLY — NOT SENT TO SHIP**. Click **Engage Heading** and
   see the amber ordered marker and actual white bow respond to the same
   authoritative ship orientation used on the Main Screen.
3. Edit pitch/roll using the steppers; select **Use facing** or **Align
   to motion** and verify they only change a draft until Engage.
4. Select **APPROACH (60 m/s)**, then **Engage Speed Order**. Watch
   actual forward velocity accelerate, rather than jump instantly.
5. Use the translation pad to choose starboard and/or dorsal drift; click
   **Engage Vector** and compare actual and ordered body-relative readouts.
6. Try **Emergency Brake**. The server zeros velocity orders and brakes
   physically within its limits; live speed should fall over time.
7. Open FTL Planner, plot a destination and use cruise as before. Verify
   that local impulse inputs are disabled while cruise drive is engaged.
8. Open Advanced Display Settings. Camera controls, Planet Lab and the
   system map should remain available.
9. Test at 1440×900 and a smaller window; narrow screens deliberately
   stack or allow sectional scrolling, rather than shrinking controls
   until they become unreadable.

### Tests

`node --import tsx --test packages/client/src/helmInstruments.test.ts`
covers angular wrapping, bounded inputs, ship-body velocity axes,
preview/send separation and heading convergence.

GitHub Windows Node 24 / Linux Node 22 jobs still run the full flight,
planet and cruise tests. The Chromium smoke starts the actual Colyseus
server and browser, switches from Main Screen to Helm, previews and
engages a heading, engages impulse speed and translation, issues an
emergency brake, opens the FTL planner, and takes
`test-artifacts/helm-console-v2.png`.

## Future risks

- The centre viewport retains a Babylon-based interactive 3D sphere,
  not an independently moving 2D simulation. On very narrow displays,
  pointer ergonomics may benefit from a dedicated map mode.
- Drift and facing are world/body references; there is **not yet**
  a contact-relative velocity solution or safe docking automation.
- Visual fine-tuning requires actual Windows browser screenshots and
  feedback about hierarchy, typography, colours and interaction.
