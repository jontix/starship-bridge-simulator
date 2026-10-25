# Starship Audio v1 — Sound Lab prototype

## Scope and creative direction

This is a **standalone sound design laboratory**, not gameplay audio integration. Open `http://localhost:5173/sound-lab.html` from the client dev server. The simulator on `/` remains entirely server-authoritative, silent and unchanged. The bridge header has a link to the lab.

The intended identity is **cinematic starship with restrained engineering realism**:

| Propulsion | Character | Synthesis palette | Listening criterion |
| --- | --- | --- | --- |
| Local impulse | The Machine | 55 Hz sine foundation, low filtered mechanical harmonics, subtle noise and a short thruster chirp | Heavy but controlled; coast is quiet, no speed-following roaring |
| Interplanetary FTL | The Field | 110/165/220/330 Hz harmonious oscillators, slow detune motion, filtered broadband texture, 4 s rising spool sweep | Elegant, precise and smooth; doesn't wear out the crew |
| Interstellar jump | The Corridor | Low 55/82.5/110 Hz drone, evolving spectral filter, 6 s charge, impact transient, adjustable harmonic development, arrival release | Powerful engagement with restrained, listenable long transit |

The root harmonic family loosely uses D/A/E-style open-fifth relationships rather than a melody. The initial sample-free implementation is intentionally art-directed and wholly procedural, with no third-party licences to manage.

## How to audition

On the `feature/starship-audio-v1` branch, from the repo root:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run dev
```

Visit `http://localhost:5173/sound-lab.html`.

1. Select **Enable Audio**. Browsers will not autoplay the soundbed on page load. Start at a low headphone/speaker volume.
2. Select **Preview Thrust**, adjust drive intensity and texture, then **Coast / Quiet** to hear the absence of propulsion.
3. Select **Spool + Engage**. The four-second electrical charge transitions automatically into a held, modulating FTL field. Select **Drop to Local** to hear the falling sweep and local tone.
4. Select **Charge + Enter**. Six seconds of charging transitions automatically into the sustained corridor sound, which may be auditioned at leisure; use the **Jump harmonic evolution** slider to compare the colour of the soundbed. Select **Preview Arrival** for a short release and return to local tone.
5. Select **Mute / Stop** at any time. It cancels pending transitions and suspends the AudioContext. You can re-enable with another user gesture.

The four sliders adjust master level, drive intensity, harmonic/noise texture and jump corridor evolution. The browser contains a compressor safety stage, but **please still begin at a low physical speaker/headphone volume**.

## Design/implementation boundaries

- Engine: `packages/client/src/soundLabAudio.ts`, zero external audio packages and no audio assets.
- Controls and preview sequencing: `packages/client/src/soundLab.ts`.
- Separate Vite page: `packages/client/sound-lab.html`, built alongside the bridge and Planet Lab.
- The prototype **does not connect to Colyseus**, modify the ship, alter tick timing, record audio, persist preferences, or start automatically.
- Local palette is an artist's mock-up driven by a lab slider. Later bridge integration should derive gain from actual `ship.acceleration` rather than `ship.velocity`; drifting remains nearly silent.
- FTL mock-up follows the existing `local → spooling → cruise → dropping` modes; the preview spool is 4 seconds.
- Jump mock-up follows the authoritative `idle → charging → transit → idle` sequence, with 6/45-second real-game phases. The lab only performs the first six seconds automatically; the 45-second transit is free-running and has an explicit Arrival button for rapid sound design comparison.
- Browser main thread clocks drive *lab previews only*. Later gameplay audio must follow server-confirmed snapshots, not run the jump itself.
- Avoid replaying start/arrival effects on reconnect, system switch, station change, or late join. Stop and dispose audio resources cleanly when leaving the lab.

## Acceptance and next steps

Automated smoke: `node scripts/smoke-sound-lab-browser.mjs`. It launches Chromium, checks no autoplay, creates and resumes an actual Web Audio context on click, exercises local/FTL/jump states, the 4/6-second preview timing, live slider updates, arrival and mute, and takes screenshots. CI tests building and existing core regressions on Node 22 Linux and Node 24 Windows.

**A human listening review remains essential.** In headphones and laptop speakers, evaluate dynamic range, whether local thrust feels massive, whether FTL is clearly unlike impulse, whether the jump impact is satisfying but not startling, and whether the corridor remains pleasant on repeats. The browser test cannot judge timbre, comfort, bass balance or headphone fatigue.

Proposed follow-on only after listening acceptance: iterate sound palette; add carefully licensed/design-original recorded accents if needed; create a persistent shared bridge audio presenter with sound enable/volume/mute controls, event sequence deduplication, phase-aware fades, and Helm/Main Screen mix differences.

Keep work in a **draft PR targeting main** until the owner confirms the sound direction and explicitly authorises merge.
