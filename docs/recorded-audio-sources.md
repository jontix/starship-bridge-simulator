# Recorded sound effects — source, licensing and how to acquire

The revised Starship Audio Sound Lab uses **actual foley and field recordings**, not just synthesized impersonations. They are played from local files by the browser's Web Audio API. The four non-optional files are sourced from the documented CC0/public-domain pages below; an optional camera-flash recording is obtained separately.

## Acquiring the recordings

From the repository root, on `feature/starship-audio-v1`:

```powershell
npm.cmd run audio:fetch
npm.cmd run dev
```

Open `http://localhost:5173/sound-lab.html` and click **Enable Audio**. A status line confirms exactly which recordings were successfully decoded. Binary media live in `packages/client/public/sound-lab/recorded/` and are intentionally excluded from Git. The acquisition script validates file headers, imposes size/time limits, caches valid downloads, and records the SHA-256 of each file in a generated local source manifest. This lets a clean checkout reproduce the sound without opaque assets or silently misrepresented licences.

| File | Purpose and original description | Creator | Licence | Verified description |
| --- | --- | --- | --- | --- |
| `rumble.ogg` | Recorded ocean during a wild windy day with low-pass filtering; used as low-frequency thruster turbulence | gmason | CC0 1.0 | https://opengameart.org/content/underwater-or-space-engine-rumble |
| `glass.wav` | Glass-breaking foley, game-ready short recording | Till Behrend / TinyWorlds | CC0 1.0 | https://opengameart.org/content/glass-break |
| `car.wav` | Moving car sound; short portions are rate shifted and stereo panned to simulate fast corridor pass-bys | Yaroslav_Novikov | CC0 1.0 | https://opengameart.org/content/car-1-1 |
| `thunder.ogg` | Real rain and thunder recorded in Sundbyberg, Sweden on 27 August 2006 | Caesar | Dedicated by author to public domain | https://commons.wikimedia.org/wiki/File:Rain_and_thunder.ogg |

CC0 reference: https://creativecommons.org/publicdomain/zero/1.0/ . A separate attribution is not legally mandated for CC0, but creator and provenance are preserved above for transparency and future replacements. Original source recordings are not included in the git commit; only this acquisition tool and source notes are checked in.

**Important sound-quality caveats:** The engine rumble is processed ocean audio rather than a rocket engine recording. The moving-car clip is not documented as a racing flyby; we apply pitch and panning to create the impression of an overtaking vehicle. The thunder clip contains rain; the playback system finds its loudest moment and excerpts it. These are a more realistic *starting point* than synthetic sine-wave imitations, but are not yet a professionally mixed final soundscape.

## Camera flash: recorded CC0 option, manual acquisition

Freesound has verified real camera-flash charging recordings under CC0, for example:

- [`Camera Flash Charging.aif` by ftpalad](https://freesound.org/people/ftpalad/sounds/119902/) (7.4 s, real external flash charging, CC0).
- [`camera flash charge.wav` by adeluc4](https://freesound.org/people/adeluc4/sounds/125326/) (9.9 s, recorded camera flash firing/charging, CC0).
- [`[Loud] Camera Flash Charge-Up` by sammerz_](https://freesound.org/people/sammerz_/sounds/842933/) (31.8 s, recorded on SM57, CC0).

Freesound original downloads require a signed-in account; **the fetch script does not scrape these files or bypass login**. Download a CC0 original directly yourself, use a local editor to export a short segment as PCM WAV, and place it at `packages/client/public/sound-lab/recorded/capacitor.wav`. The Sound Lab detects and decodes it automatically when enabled or reloaded. Without this file, the existing procedural capacitor sweep remains as an **explicitly identified fallback**. Do not use CC BY-NC/noncommercial recordings in the game without separate commercial permission.

## What is now recorded versus synthesized

- **Local:** looped *real-world wind/ocean rumble* under changing thrust; synthetic low-frequency tone adds hull mass. Coast mutes both.
- **FTL:** *real glass cracking and falling*, backed by synthetic discordant drive field. The flash-capacitor recording is optional until locally provided.
- **Jump:** *recorded thunder* at both sides of the corridor and *recorded car audio* for seven irregular spatial pass-bys; underlying spooky field remains synthetic.

This is **only a Sound Lab audition**. There is no music, no live gameplay audio, and no changes to ship physics, travel state or multiplayer roles. Human listening approval is needed before recording further bespoke foley, adding significant asset dependencies, or merging PR #11.
