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

The output meter reads through the same K-weighting, so it shows perceived
level rather than raw amplitude — a rig with a big low end does not just peg it.

**The flight time is trimmed off the front.** Sound really does take two tenths
of a second to cross a stadium, and the model knows it — but nobody wants to
wait through that every time they press play. Both loudspeaker responses are
shifted by the same amount, whichever reaches you first, so the music starts
immediately while the few hundred microseconds *between* the two speakers,
which is what places the stereo image, survive intact.

**A/B is loudness-matched.** Switching between the room and the raw file plays
pink noise through an exact copy of the chain, measures both through the
ITU-R BS.1770 K-weighting filter broadcast loudness meters use, and matches
them. So the comparison is of character, not volume. This is measured rather
than calculated, because the honest answer depends on the spectrum of the
material — a room with a long bass decay adds far more to a bass-heavy record
than a flat energy sum would predict.

### Every room gets the same test

"Best case" is easy to claim and easy to fake, so it is checked against a
number. Beranek's **bass ratio** — (RT125 + RT250) / (RT500 + RT1k) — is what
separates a warm room from a boomy one; the great concert halls measure
1.1–1.25, and a treated control room sits near 1.0. Auditing all nine found
four rooms that were not best case at all, only average ones:

| Room | Was | Now | What fixed it |
|---|---|---|---|
| Control Room | 2.22 | 1.29 | Deep porous absorbers over an air gap, instead of thin panels that do nothing below 200 Hz |
| Jazz Club | 1.86 | 1.29 | Real depth in the ceiling treatment; the brick stays, it is the whole character |
| Concert Hall | 1.44 | 1.17 | Thin timber panelling over a cavity — how the great halls actually get their bass ratio down |
| Nightclub | 2.17 | 1.47 | Bass traps in the ceiling, and cardioid subs |

A control room with a 2.2 bass ratio is not a reference, it is the modal boom
that treatment exists to remove. A club whose bass hangs on for 1.8 seconds
cannot make a kick drum land, whatever the copy says.

The three rooms with a big low end — nightclub, stadium, field — now also run
**cardioid sub arrays**. A plain subwoofer is nearly omnidirectional, so half
its low end goes into the walls; delaying and flipping the rear boxes cancels
most of that. It is standard on any modern rig and it is why a good one does
not boom the room out.

### The church, in particular

It is the room the whole idea is really for, so it gets the most attention. Its
decay is shaped to the profile a beautiful nave actually has — warm at the
bottom, peaking around 250 Hz, falling smoothly above, with the air taking the
very top:

| | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|
| Decay, s | 4.4 | 4.7 | 4.3 | 4.0 | 3.6 | 2.9 | 1.7 |

That warm falling shape, rather than a mid-forward ring, is most of what
separates a cathedral you want to sit in from one that turns music to mush. The
rest is the system: a digitally steered column throws a tight vertical beam down
the nave and barely touches the walls, so the direct sound stays defined while
the room still blooms behind it — and it runs full-range, because a stone nave
supports low end like nothing else and a system that stops at 90 Hz throws that
away.

## The rooms

**Every room is the best version of itself.** Not an average stadium with a
rung-out PA, but a properly flown array that a system engineer has actually
tuned, in a room with the treatment a good example of it would have. Voicings
are smooth house curves rather than caricatures, drive levels are what a
well-run rig actually does, pattern control is what a well-specified system
buys you, and the distant rigs get the high end shelved back up to replace what
the air takes out — capped at 6 dB, because a real rig runs out of headroom too.
What stays honest is the physics: the size, the distance, the decay.

Each room also puts you in one chosen place. There is an obvious spot to be in
every one of these — the sweet spot in a control room, the middle of the bowl in
a stadium — so the app decides, rather than handing over a distance slider.

| Room | Size | Where you are | Decay (500 Hz–1 kHz) | System |
|---|---|---|---|---|
| Control Room | 6.5 × 4.8 × 3.0 m | Sweet spot, 1.6 m back | 0.13 s | Studio monitors |
| Living Room | 7.5 × 5.0 × 2.7 m | On the sofa, 3.2 m back | 0.30 s | Good hi-fi speakers |
| Jazz Club | 12 × 9 × 3.2 m | Two tables back, 4.5 m | 0.31 s | Small club PA with subs |
| Concert Hall | 45 × 22 × 17 m | Mid-stalls, 18 m | 1.95 s | Subtle concert-hall PA |
| Stone Church | 30 × 14 × 15 m | Ten rows back, 10 m from the speakers | 4.1 s | Steered column speakers + subs |
| Nightclub | 24 × 16 × 5.5 m | On the dance floor, 9 m | 0.58 s | Club rig with big (cardioid) subs |
| Stadium | 190 × 140 m, open | Middle of the crowd, 67 m | 1.3 s | Concert line array + 6 dB air compensation |
| Open Air Field | no walls | In the crowd, 74 m | 0.41 s | Concert line array + 6 dB air compensation |
| Car | 2.4 × 1.6 × 1.15 m | Driver's seat, nothing centred | 0.08 s | Tuned car speakers |

Responses are built on the device when you pick a room — 40 ms to 700 ms
depending on how long its decay is.

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

## On a phone

The file path is the one that matters, so it has had the attention:

- The audio engine wakes on the **tap of the button**, a guaranteed user
  gesture, rather than on the file picker's change event, which some browsers
  do not count as one. If a browser still refuses to autoplay, the play button
  is right there and a toast says so.
- iOS reports `interrupted` rather than `suspended` after a phone call or a
  trip to another app; the engine resumes on anything that is not `running`,
  and again when the page becomes visible with a track still marked playing.
- Lock-screen and headphone-button controls work through the Media Session
  API, which also tells the phone this is music rather than a sound effect.
- Switching rooms renders and level-matches the new room while the old one
  keeps playing, then swaps with a 25 ms dip. A room you clicked away from
  before it finished is dropped rather than landing on top of the newer one.
- The microphone source is hidden on touch devices: a phone's mic through
  headphones is not a use anyone wants, and on Bluetooth it drops the whole
  headset into low-quality call mode. Tab capture is hidden where the browser
  cannot do it.
- Unsupported formats get a specific message (Safari cannot play Ogg or Opus).
  MP3, M4A/AAC, WAV and FLAC work everywhere.

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
- Picking a room rebuilds its response, which is a brief pause on a slow phone.
  The *Light* setting halves the response length and roughly halves the build
  time.
- One position and one drive level per room. That is the point — but it means
  you cannot walk to the back of the church to hear what changes.
- Every venue is its best case by design, so none of these will tell you what a
  badly tuned system sounds like. That was not what it is for.
- On iOS, Web Audio processing stops when the screen locks. The media element
  keeps the session alive on recent versions, but this is not something a web
  page can guarantee; if the room drops out on lock, that is why.
