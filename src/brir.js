/**
 * brir.js — synthesises binaural room impulse responses.
 *
 * Why binaural and not a plain stereo reverb: on headphones a conventional
 * reverb still sounds like it is inside your skull. What makes a room appear
 * *around* you is that each reflection reaches the two ears at slightly
 * different times and with a different frequency balance, because your head is
 * in the way. Model that and the church moves outside your head.
 *
 * The response is built in three layers:
 *   1. Direct sound + early reflections, from a randomised image-source model
 *      of a shoebox room, with per-octave-band wall absorption and scattering,
 *      air absorption, and frequency-dependent loudspeaker directivity.
 *   2. A stochastic late tail whose decay follows the Eyring reverberation
 *      time per band, and whose interaural coherence follows the diffuse-field
 *      sinc law — coherent below ~700 Hz, incoherent above it.
 *   3. A spherical-head binaural stage: Woodworth interaural time difference
 *      plus the Brown & Duda head-shadow magnitude, applied per band, plus
 *      pinna cues for elevation and front/back.
 *
 * The seven band signals are kept separate all the way through and only summed
 * after a Linkwitz-Riley filterbank, so the frequency-dependent behaviour
 * survives instead of being smeared into one broadband decay.
 */

import {
  C_AIR, HEAD_RADIUS, BAND_CENTRES, BAND_EDGES, NBANDS,
  AIR_ABSORPTION_DB_M, SURFACES, MATERIALS,
  reflectionCoefficients, scatterCoefficients, reverbTimes, mixingTime,
  clamp,
} from './acoustics.js';

/* ---------------------------------------------------------------- helpers */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Unit-variance white noise for the reverberant tail.
 * Uniform rather than Gaussian on purpose: after the octave filterbank the
 * amplitude distribution converges on Gaussian anyway, and the cheap version
 * takes a second off building a cathedral on a phone.
 */
const NOISE_SCALE = Math.sqrt(12);
function noise(rnd) {
  return (rnd() - 0.5) * NOISE_SCALE;
}

/** 8-tap Lanczos kernel. Fractional delays matter: rounding every reflection to
 *  the nearest sample destroys the fine interaural time differences the ear
 *  uses to place a sound, which is most of the effect we are after. */
function lanczos(x) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 4) return 0;
  const pix = Math.PI * x;
  return (4 * Math.sin(pix) * Math.sin(pix / 4)) / (pix * pix);
}

function addImpulse(buf, tSamples, amp) {
  if (!(amp > 1e-9) && !(amp < -1e-9)) return;
  const n = Math.floor(tSamples);
  const frac = tSamples - n;
  for (let k = -3; k <= 4; k++) {
    const i = n + k;
    if (i < 0 || i >= buf.length) continue;
    buf[i] += amp * lanczos(k - frac);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/* ------------------------------------------------------- binaural head model */

/**
 * Brown & Duda's spherical head-shadow magnitude, evaluated at each band centre.
 * theta is the angle between the source direction and the ear's outward axis:
 * 0 = source at that ear, PI = source at the far ear.
 */
const OMEGA_0 = C_AIR / HEAD_RADIUS;
const THETA_MIN = (150 * Math.PI) / 180;
const ALPHA_MIN = 0.1;

function headShadow(theta, out) {
  const alpha = 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * Math.cos((theta / THETA_MIN) * Math.PI);
  for (let b = 0; b < NBANDS; b++) {
    const w = (2 * Math.PI * BAND_CENTRES[b]) / (2 * OMEGA_0);
    out[b] = Math.sqrt(1 + (alpha * w) ** 2) / Math.sqrt(1 + w * w);
  }
  return out;
}

/** Extra path length to one ear, relative to the head centre (Woodworth). */
function earPathOffset(theta) {
  return theta < Math.PI / 2
    ? -HEAD_RADIUS * Math.cos(theta)
    : HEAD_RADIUS * (theta - Math.PI / 2);
}

/**
 * Pinna cues. The outer ear puts a notch in the 5-11 kHz region whose centre
 * rises with elevation, and shadows high frequencies for sources behind you.
 * Approximated at band resolution — enough to keep the stage in front.
 */
function pinnaGains(forward, up, out) {
  out.fill(1);
  const notchHz = 6300 * Math.pow(2, clamp(up, -1, 1) * 0.62);
  let nearest = 0;
  let best = Infinity;
  for (let b = 0; b < NBANDS; b++) {
    const d = Math.abs(Math.log2(BAND_CENTRES[b] / notchHz));
    if (d < best) { best = d; nearest = b; }
  }
  out[nearest] *= 0.55;
  if (nearest + 1 < NBANDS) out[nearest + 1] *= 0.82;
  if (forward < 0) {
    const back = -forward;
    out[5] *= Math.pow(10, (-5.0 * back) / 20);
    out[6] *= Math.pow(10, (-7.5 * back) / 20);
    out[4] *= Math.pow(10, (-2.0 * back) / 20);
  }
  return out;
}

/* ------------------------------------------------------ speaker directivity */

/** Exponents of a ((1+cos b)/2)^p pattern per band: near-omni in the bass,
 *  strongly beamed at 8 kHz — the reason a room's reflections are duller than
 *  the sound arriving straight at you. */
const DIRECTIVITY_P = [0.15, 0.3, 0.6, 1.1, 1.8, 2.6, 3.4];
const DIRECTIVITY_FLOOR = 0.06;

function directivityGains(cosBeta, spread, out) {
  const x = Math.max(0, (1 + cosBeta) / 2);
  for (let b = 0; b < NBANDS; b++) {
    const p = DIRECTIVITY_P[b] * spread;
    out[b] = DIRECTIVITY_FLOOR + (1 - DIRECTIVITY_FLOOR) * Math.pow(x, p);
  }
  return out;
}

/* -------------------------------------------------------- image source model */

/**
 * Accumulates direct sound and early reflections into per-band, per-ear buffers.
 * Returns the number of reflections actually placed.
 */
function renderImageSources(cfg, bandBuf, sampleRate, rnd) {
  const { dims, listener, yaw, source, aim, spread, beta, scat, tMix, irSeconds, t0, leadTrim } = cfg;
  const [Lx, Ly, Lz] = dims;

  const fwdVec = [Math.cos(yaw), Math.sin(yaw), 0];
  const leftVec = [-Math.sin(yaw), Math.cos(yaw), 0];

  // Enough reflection orders to reach the mixing time in the smallest dimension.
  const minDim = Math.min(Lx, Ly, Lz);
  const order = clamp(Math.ceil((tMix * 1.6 * C_AIR) / minDim), 2, 7);

  const shadowL = new Float32Array(NBANDS);
  const shadowR = new Float32Array(NBANDS);
  const pinnaL = new Float32Array(NBANDS);
  const pinnaR = new Float32Array(NBANDS);
  const dirG = new Float32Array(NBANDS);

  // All handover timing is measured from the arrival of the direct sound, not
  // from zero: across a stadium the direct sound does not turn up for a third
  // of a second, and the tail must not start before it.
  const tFade = t0 + tMix;
  const tEnd = Math.min(irSeconds + leadTrim, tFade + 0.5 * tMix);
  let placed = 0;

  for (let ux = 0; ux <= 1; ux++) {
    for (let uy = 0; uy <= 1; uy++) {
      for (let uz = 0; uz <= 1; uz++) {
        const sx = 1 - 2 * ux;
        const sy = 1 - 2 * uy;
        const sz = 1 - 2 * uz;
        for (let mx = -order; mx <= order; mx++) {
          for (let my = -order; my <= order; my++) {
            for (let mz = -order; mz <= order; mz++) {
              // Wall hit counts, per Allen & Berkley.
              const nX0 = Math.abs(mx - ux), nX1 = Math.abs(mx);
              const nY0 = Math.abs(my - uy), nY1 = Math.abs(my);
              const nZ0 = Math.abs(mz - uz), nZ1 = Math.abs(mz);
              const refl = nX0 + nX1 + nY0 + nY1 + nZ0 + nZ1;
              if (refl > order + 2) continue;

              let px = sx * source[0] + 2 * mx * Lx;
              let py = sy * source[1] + 2 * my * Ly;
              let pz = sz * source[2] + 2 * mz * Lz;

              // Randomised image positions break up the metallic comb filtering
              // a perfect shoebox would otherwise produce.
              if (refl > 1) {
                const j = 0.055 * (refl - 1);
                px += (rnd() - 0.5) * 2 * j;
                py += (rnd() - 0.5) * 2 * j;
                pz += (rnd() - 0.5) * 2 * j;
              }

              const v = sub([px, py, pz], listener);
              const d = norm(v);
              const t = d / C_AIR;
              if (t > tEnd) continue;

              // Handover taper into the stochastic tail.
              let fade = 1;
              if (t > tFade) {
                const u = (t - tFade) / (0.5 * tMix);
                fade = 0.5 * (1 + Math.cos(Math.PI * clamp(u, 0, 1)));
              }
              if (fade < 0.002) continue;

              const inv = 1 / d;
              const dirUnit = [v[0] * inv, v[1] * inv, v[2] * inv];
              const forward = dot(dirUnit, fwdVec);
              const left = dot(dirUnit, leftVec);
              const up = dirUnit[2];

              const thetaL = Math.acos(clamp(left, -1, 1));
              const thetaR = Math.acos(clamp(-left, -1, 1));
              headShadow(thetaL, shadowL);
              headShadow(thetaR, shadowR);
              pinnaGains(forward, up, pinnaL);
              pinnaGains(forward, up, pinnaR);

              // Emission angle: the source's aim is mirrored along with it.
              const aimImg = [sx * aim[0], sy * aim[1], sz * aim[2]];
              directivityGains(-dot(aimImg, dirUnit), spread, dirG);

              // Sample positions are measured from the moment the sound first
              // reaches the listener, not from when it left the speaker: the
              // flight time is real but there is no reason to make anyone wait
              // through it before the music starts.
              const tL = ((d + earPathOffset(thetaL)) / C_AIR - leadTrim) * sampleRate;
              const tR = ((d + earPathOffset(thetaR)) / C_AIR - leadTrim) * sampleRate;

              const spread1r = fade / Math.max(d, 0.35);
              const counts = [nX0, nX1, nY0, nY1, nZ0, nZ1];

              for (let b = 0; b < NBANDS; b++) {
                let wall = 1;
                for (let f = 0; f < 6; f++) {
                  const n = counts[f];
                  if (n === 0) continue;
                  wall *= Math.pow(beta[f][b] * Math.sqrt(1 - scat[f][b]), n);
                }
                if (wall < 1e-5) continue;
                const air = Math.pow(10, (-AIR_ABSORPTION_DB_M[b] * d) / 20);
                const base = spread1r * wall * air * dirG[b];
                addImpulse(bandBuf[b][0], tL, base * shadowL[b] * pinnaL[b]);
                addImpulse(bandBuf[b][1], tR, base * shadowR[b] * pinnaR[b]);
              }
              placed++;
            }
          }
        }
      }
    }
  }
  return { placed, order };
}

/* ------------------------------------------------------------- late reverb */

/** Diffuse-field interaural coherence: sinc(2*pi*f*d/c) across the head. */
function diffuseCoherence(f) {
  const x = (2 * Math.PI * f * 2 * HEAD_RADIUS) / C_AIR;
  return x === 0 ? 1 : Math.sin(x) / x;
}

function renderLateTail(cfg, bandBuf, sampleRate, rnd) {
  const { rt60, tMix, irSeconds, t0, diffuse, diffuseRefDb, leadTrim } = cfg;
  if (diffuse <= 0) return;
  const len = bandBuf[0][0].length;

  // Sample index of a physical time, allowing for the trimmed flight time.
  const idx = (t) => Math.floor((t - leadTrim) * sampleRate);
  const iFadeStart = idx(t0 + 0.5 * tMix);
  const iFadeEnd = idx(t0 + tMix);
  const iMeasureFrom = idx(t0 + 0.55 * tMix);
  const fadeSpan = Math.max(1, iFadeEnd - iFadeStart);

  const tailL = new Float32Array(len);
  const tailR = new Float32Array(len);

  for (let b = 0; b < NBANDS; b++) {
    const T = Math.max(0.05, Math.min(rt60[b], irSeconds));
    const gamma = diffuseCoherence(BAND_CENTRES[b]);
    const mixA = Math.abs(gamma);
    const mixB = Math.sqrt(Math.max(0, 1 - gamma * gamma));
    const sgn = gamma < 0 ? -1 : 1;

    tailL.fill(0);
    tailR.fill(0);

    let last = iFadeStart;
    for (let i = Math.max(0, iFadeStart); i < len; i++) {
      const env = Math.pow(10, (-3 * (i / sampleRate + leadTrim - t0 - 0.5 * tMix)) / T);
      if (env < 1e-6) break;
      const u = (i - iFadeStart) / fadeSpan;
      const fade = u >= 1 ? 1 : 0.5 * (1 - Math.cos(Math.PI * u));
      const g = fade * env;
      const nc = noise(rnd);
      tailL[i] = g * (mixA * nc + mixB * noise(rnd));
      tailR[i] = g * (sgn * mixA * nc + mixB * noise(rnd));
      last = i;
    }

    // Match the tail to the energy of the early reflections it takes over from,
    // measured in the window just before the handover. Levels then join up
    // however absorbent the room turns out to be.
    let eIsmL = 0, eIsmR = 0, eTailL = 0, eTailR = 0, n = 0;
    for (let i = iMeasureFrom; i < iFadeEnd && i < len; i++) {
      eIsmL += bandBuf[b][0][i] ** 2;
      eIsmR += bandBuf[b][1][i] ** 2;
      eTailL += tailL[i] ** 2;
      eTailR += tailR[i] ** 2;
      n++;
    }
    if (n === 0) continue;

    // Outdoors there may be no early reflections in that window at all — one
    // ground bounce and then nothing. There is still some diffuse return from
    // the crowd and the site, so the venue states how far below the direct
    // sound it sits and the level is taken from there instead.
    const floorE = 1e-14 * n;
    if (eIsmL < floorE && eIsmR < floorE && diffuseRefDb != null) {
      const ref = Math.pow(10, diffuseRefDb / 10);
      let dL = 0, dR = 0, dn = 0;
      const from = Math.max(0, idx(t0) - 4);
      const to = Math.min(len, from + Math.ceil(0.03 * sampleRate));
      for (let i = from; i < to; i++) { dL += bandBuf[b][0][i] ** 2; dR += bandBuf[b][1][i] ** 2; dn++; }
      if (dn > 0) { eIsmL = (dL / dn) * ref * n; eIsmR = (dR / dn) * ref * n; }
    }
    const kL = eTailL > 1e-20 ? diffuse * Math.sqrt(eIsmL / eTailL) : 0;
    const kR = eTailR > 1e-20 ? diffuse * Math.sqrt(eIsmR / eTailR) : 0;
    if (kL === 0 && kR === 0) continue;

    for (let i = Math.max(0, iFadeStart); i <= last; i++) {
      bandBuf[b][0][i] += kL * tailL[i];
      bandBuf[b][1][i] += kR * tailR[i];
    }
  }
}

/* ------------------------------------------------------------- filterbank */

function butterworthPair(ctx, type, freq) {
  const a = ctx.createBiquadFilter();
  const b = ctx.createBiquadFilter();
  a.type = b.type = type;
  a.frequency.value = b.frequency.value = freq;
  a.Q.value = b.Q.value = Math.SQRT1_2;
  a.connect(b);
  return { input: a, output: b };
}

/**
 * Sums the seven band signals through a Linkwitz-Riley filterbank.
 * Runs in an OfflineAudioContext so the browser's own (SIMD) biquads do it.
 */
async function collapseBands(bandBuf, sampleRate, len) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(2, len, sampleRate);
  for (let b = 0; b < NBANDS; b++) {
    const buf = ctx.createBuffer(2, len, sampleRate);
    buf.copyToChannel(bandBuf[b][0], 0);
    buf.copyToChannel(bandBuf[b][1], 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let tail = src;
    if (b > 0) {
      const hp = butterworthPair(ctx, 'highpass', BAND_EDGES[b - 1]);
      tail.connect(hp.input);
      tail = hp.output;
    }
    if (b < NBANDS - 1) {
      const lp = butterworthPair(ctx, 'lowpass', BAND_EDGES[b]);
      tail.connect(lp.input);
      tail = lp.output;
    }
    tail.connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}

/* ------------------------------------------------------------------ public */

/**
 * Build one binaural impulse response: a single loudspeaker in a room,
 * rendered to the listener's two ears.
 *
 * @returns {Promise<AudioBuffer>} 2-channel buffer — channel 0 is the left ear.
 */
export async function renderSpeakerBRIR(opts) {
  const {
    dims, materials, listener, yaw, source, aim,
    spread = 1, sampleRate, irSeconds, seed = 1,
    diffuse = 1, rt60Override = null, diffuseRefDb = null, leadTrim = 0,
  } = opts;

  const rnd = mulberry32(seed);
  // Outdoors there is no reverberant field for Eyring to describe: the formula
  // still returns a number because the "room" has a huge volume, but the number
  // is meaningless. Those venues supply their own decay instead.
  const rt60 = rt60Override ? rt60Override.slice() : reverbTimes(dims, materials);
  const tMix = mixingTime(dims);
  const t0 = Math.hypot(source[0] - listener[0], source[1] - listener[1], source[2] - listener[2]) / C_AIR;
  const len = Math.max(256, Math.round(irSeconds * sampleRate));

  const bandBuf = [];
  for (let b = 0; b < NBANDS; b++) {
    bandBuf.push([new Float32Array(len), new Float32Array(len)]);
  }

  const cfg = {
    dims, listener, yaw, source, aim, spread,
    beta: reflectionCoefficients(materials),
    scat: scatterCoefficients(materials),
    rt60, tMix, irSeconds, t0, diffuse, diffuseRefDb, leadTrim,
  };

  const ism = renderImageSources(cfg, bandBuf, sampleRate, rnd);
  renderLateTail(cfg, bandBuf, sampleRate, rnd);
  const rendered = await collapseBands(bandBuf, sampleRate, len);

  return {
    buffer: rendered, rt60, tMix, t0,
    onset: t0 - leadTrim,
    reflections: ism.placed, order: ism.order,
  };
}

export { MATERIALS, SURFACES, BAND_CENTRES };
