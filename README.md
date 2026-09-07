# Sound Stage

Play a track and hear it as though it were coming out of a loudspeaker system,
in a room, with you standing somewhere in that room — a stone church, a stadium,
a good living room, a car. On headphones.

It is a single web page. Open it on a phone, add it to the home screen, and it
works offline; every room is computed on the device.

---

## Can this work with Spotify or Apple Music? No — and here is exactly why

This was the first question, so it gets the first answer, unhedged.

**No app on a phone can process the audio coming out of another app.**

- **iOS** has no system-audio capture API at all. There is no equivalent of a
  virtual output device, `AVAudioEngine` cannot tap another process, and
  screen recording deliberately excludes other apps' audio. The Spotify iOS SDK
  only *controls* playback happening inside the Spotify app; no samples ever
  reach you. Apple Music tracks are protected, so even `MusicKit` hands you a
  player, never a buffer.
- **Android** has `AudioPlaybackCapture` (API 29+), but the app being captured
  must permit it. Spotify does not, and DRM-protected streams are excluded from
  capture at the framework level regardless.
- **System-wide EQ apps** on Android (Wavelet and similar) attach to the
  platform's own effect slots. Those slots offer an equaliser and a dynamics
  processor — not arbitrary convolution — and the mechanism is unreliable
  across devices.

That leaves three honest options, in order of how well they work:

| Approach | Quality | Works on a phone | Works with Spotify |
|---|---|---|---|
| **Be the player** — the app decodes the audio itself | Best. Full float pipeline, any processing you like | Yes | No — your own files only |
| **Capture a browser tab** on a desktop and process that | Very good | No, desktop only | Only for non-DRM sources |
| **Virtual audio device** on a desktop (BlackHole, Loopback, VB-Cable) into a convolver | Best, and it does capture Spotify | No, desktop only | Yes |

This app does the first, and the second where the browser allows it. If
processing Spotify specifically is the goal, the only real answer is a computer
with a virtual audio device — which is a different product from the one asked
for, so it is not what got built.

## What it actually does

Three stages, in the order reality does them:

```
source ──▶ loudspeaker voicing ──▶ the room ──▶ your two ears
           EQ + soft clip           convolution     binaural
```

**The loudspeaker comes before the room.** A stadium rig is already band-limited
and driven hard by the time its sound reaches the air, so the room reverberates
a signal that has been through the PA. Reverb-after-EQ is the usual reason
"amp sim plus reverb" sounds like an effect rather than a place.

**The room is a physical model, not a reverb preset.** Every venue in
[`src/venues.js`](src/venues.js) is a real shoebox in metres with real surface
materials. Nothing is a decay-time knob: change a dimension or a wall covering
and the sound changes the way the physics says it should. The decay times the
app prints are computed from those numbers.

Each response is built in three layers, in seven octave bands throughout
([`src/brir.js`](src/brir.js)):

1. **Direct sound and early reflections** — a randomised image-source model of
   the room, with per-band wall absorption and scattering, atmospheric
   absorption (which is why a stadium's top end never survives the ninety-metre
   trip), and frequency-dependent loudspeaker directivity, so reflections are
   duller than the sound arriving straight at you. Reflections are placed at
   fractional sample positions, because rounding them to the nearest sample
   destroys the interaural timing the ear uses to locate things.
2. **A diffuse late tail** whose decay follows the Eyring reverberation time per
   band, and whose interaural coherence follows the diffuse-field sinc law —
   coherent below about 700 Hz, incoherent above it. Its level is matched to
   the early energy it takes over from, so the two layers join up seamlessly
   however absorbent the room is.
3. **A spherical-head binaural stage** — Woodworth interaural time difference,
   the Brown & Duda head-shadow magnitude applied per band, and pinna cues for
   elevation and front/back.

That last layer is the one that matters most on headphones. A conventional
stereo reverb still sounds like it is inside your skull; modelling the fact
that your head is in the way puts the room *around* you.

**A/B is loudness-matched.** Switching between the room and the raw file plays
pink noise through an exact copy of the chain, measures both through the
ITU-R BS.1770 K-weighting filter broadcast loudness meters use, and matches
them. So the comparison is of character, not volume. This is measured rather
than calculated, because the honest answer depends on the spectrum of the
material — a room with a long bass decay adds far more to a bass-heavy record
than a flat energy sum would predict.

## The rooms

| Room | Size | Decay (500 Hz–1 kHz) | System |
|---|---|---|---|
| Control Room | 6.5 × 4.8 × 3.0 m | 0.13 s | Nearfield monitors |
| Living Room | 7.5 × 5.0 × 2.7 m | 0.38 s | Hi-fi bookshelf pair |
| Jazz Club | 12 × 9 × 3.2 m | 0.32 s | Small club PA |
| Concert Hall | 45 × 22 × 17 m | 2.2 s | Discreet reinforcement |
| Stone Church | 30 × 14 × 15 m | 4.6 s | Column array |
| Nightclub | 24 × 16 × 5.5 m | 0.94 s | Stacked rig, horn subs |
| Stadium | 190 × 140 m, open | 1.3 s | Flown line array, 95 m away |
| Open Air Field | no walls | 0.49 s | Line array, 104 m away |
| Car | 2.4 × 1.6 × 1.15 m | 0.08 s | Factory door speakers |

The seat slider moves you through the room, which changes the balance between
direct sound and reverberation the way walking backwards does. Each move
rebuilds the response — 60 ms to 600 ms depending on the room.

## Running it

Any static server; there is no build step for development.

```sh
npx http-server -p 8080 .      # then open http://localhost:8080
```

On a phone, open the page and use the browser's *Add to Home Screen*. The
service worker caches the shell, so it opens without a network afterwards.

`node build.js` flattens everything into `dist/sound-stage.html`, a single
self-contained file with no dependencies.

## Layout

| File | What it holds |
|---|---|
| `src/acoustics.js` | Constants, published absorption and scattering coefficients, Eyring and mixing-time maths |
| `src/brir.js` | Binaural room impulse response synthesis |
| `src/venues.js` | Room geometry, materials and loudspeaker voicings |
| `src/engine.js` | Web Audio graph, sources, loudness calibration |
| `src/app.js` | Interface, reflectogram plot |
| `build.js` | Single-file bundler |

## Known limits

- Shoebox geometry only. A real church has a vaulted ceiling, side chapels and
  columns; the model gives it six flat walls. The decay time and the spectral
  balance are right; the fine structure of the early reflections is not.
- The head model is a sphere with pinna cues approximated at octave-band
  resolution, not a measured HRTF, and it is not personalised. Externalisation
  is good; precise localisation is not the goal. Loading a measured SOFA
  dataset would be the obvious next step.
- No head tracking, so the room turns when you do. Head tracking is what would
  make the illusion hold completely.
- Rooms are rebuilt when the seat moves, which is a visible pause on a slow
  phone. The *Light* setting halves the response length and roughly halves the
  build time.
