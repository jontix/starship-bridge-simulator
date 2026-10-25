# Starship Audio v1 — visceral cinematic Sound Lab (auditions 02)

## Creative direction

The first smooth/harmonic Sound Lab has been revised after owner feedback. These are deliberately **physical, brutal and slightly uncanny** sounds, developed as an isolated browser audition page before any live ship integration.

| Drive | New character | Audition |
| --- | --- | --- |
| Local impulse | **Deep rumbling thruster** with hull-shaking engagement and turbulence, then quiet coast | 5 s thrust plus automatic coast |
| FTL cruise | **Vintage camera-flash capacitor** whine for exactly 4 s, then brittle **shattering glass** dissolving into a **discordant, beating field** | 4 s spool + 10 s field + automatic dropout |
| Interstellar jump | **Thunder** at corridor entry and exit, a spooky / eerie low background, with fast, irregular **Doppler-like vehicle pass-bys** crossing the stereo image | 6 s charge + 15 s sample corridor + thunderous arrival |

**Sample-shaped prototype, not yet final foley recordings.** To avoid unlicensed assets and permit reproducible automated testing, this first new version constructs noise buffers and resonant shards in the browser using Web Audio. It is intended as an early audition of the sound concept. The next sonic fidelity pass should substitute properly licensed real thunder, glass, engine and vehicle recordings or commissioned custom audio. No existing third-party media are silently copied, embedded or loaded.

The sound is **diegetic bridge audio** heard inside a fictional starship, not exterior sound propagating in a vacuum. Local engine modulation will eventually follow actual thrust/acceleration, not velocity.

## Listen in browser

```powershell
git fetch origin
git switch feature/starship-audio-v1
git pull --ff-only origin feature/starship-audio-v1
npm.cmd install
npm.cmd run build
npm.cmd run dev
```

Open **http://localhost:5173/sound-lab.html**, select **Enable Audio**, and start at a low physical volume. The page can run with client Vite alone; opening Sound Lab never joins a Colyseus room.

- **Preview Thrust** runs a deep engine/low-frequency turbulence audition for 5 seconds then settles to quiet coast. **Coast / Quiet** ends thrust at once.
- **Spool + Engage** plays the electronic rising camera-capacitor whine, a glass-like fracture at 4 seconds, and dissonant cruise for 10 seconds before an automatic exit. **Drop to Local** interrupts it.
- **Charge + Enter** charges 6 seconds, emits a layered thunderclap, adds seven unevenly spaced stereo Doppler-like pass-bys across a dark and vaguely rattling corridor, then emits arrival thunder 15 seconds later. **Preview Arrival** lets you jump straight to the exit sound.
- **Master level**, **Engine / field strength**, **Turbulence / shards**, and **Corridor unease** are live audio controls.
- **Mute / Stop** cancels scheduled actions and silences any in-progress sweeps. Re-enabling sound never resumes a stale sound effect.

## Audio architecture

- `packages/client/src/soundLabAudio.ts`: three persistent low-level voice beds, mix controls, volume/compression and AudioContext lifecycle.
- `packages/client/src/cinematicDriveEffects.ts`: transient capacitor, glass-fracture, thunder and stereo pass-by synthesis. Generates deterministic filtered noise sample buffers locally, not downloaded media.
- `packages/client/src/soundLab.ts`: demo-only scene sequencing and elapsed timing. Timers use browser clock for **audition only**, not live voyage authority.
- `packages/client/sound-lab.html`: self-contained Vite page, no server/physics changes.
- `scripts/smoke-sound-lab-browser.mjs`: genuine Chromium tests for no autoplay, live synthesis, 4/6-second spool transitions, pass-bys, automatic arrival, mute and preview interruption.
- CI also builds/tests on Windows Node 24 and Linux Node 22, and runs baseline bridge regression workflows.

## Listening acceptance

Human hearing is the deciding test. Assess through headphones and laptop speakers, specifically:
1. Local impulse is low, rough and physical rather than a thin electronic hum; the coast is quiet.
2. FTL spool evokes an old camera flash charging, the glass fracture has convincing sharp transient detail, and cruising is dissonant without becoming painful.
3. Thunder at entry/exit is distinctive without startlingly excessive volume; the corridor feels like very fast vehicles repeatedly overtaking the ship, with irregular gaps and stereo movement.
4. The spooky corridor bed is atmospheric and can last the full real 45 seconds without becoming exhausting.
5. Repeated auditions do not overlap stale effects; muting and switching scenes fully cancel pending sequences.

These are **15-second corridor auditions**, not the production 45-second transport. Any future real-bridge integration must follow authoritative snapshots and deduplicate arrival cues by event sequence; no work from this branch changes existing game behaviour.

**PR #11 stays draft and unmerged pending human listening approval.**
