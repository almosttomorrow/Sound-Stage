/**
 * engine.js — the live signal path.
 *
 * The chain follows the real one, in order:
 *
 *   source -> loudspeaker voicing (EQ + soft clip) -> room (convolution) -> ears
 *
 * Putting the speaker before the room matters. A stadium rig is already
 * band-limited and driven hard by the time its sound reaches the air, so the
 * room reverberates a signal that has been through the PA — not a clean one.
 * Doing it the other way round is the usual reason "amp sim plus reverb"
 * sounds like an effect rather than a place.
 *
 * The room is two convolutions, one per loudspeaker, each with a two-channel
 * binaural response. The left channel of the music goes only through the left
 * speaker's response and arrives at both ears; likewise the right. That is what
 * a real pair of speakers in a real room does to a stereo recording.
 */

import { renderSpeakerBRIR, DIRECTIVITY_P, CARDIOID_SUB_P } from './brir.js';
import { SYSTEMS } from './venues.js';
import { clamp, dbToGain, AIR_ABSORPTION_DB_M, C_AIR } from './acoustics.js';

const RAMP = 0.02;
const SWAP_FADE = 0.025;

/* ------------------------------------------------------- loudspeaker stage */

function driveCurve(amount) {
  const d = clamp(amount, 0, 0.95);
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + d * 14;
  const tk = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (1 - d) * x + d * (Math.tanh(k * x) / tk);
  }
  return curve;
}

/**
 * Build one loudspeaker voicing. Used for the live chain and, identically, for
 * the calibration render — they have to be the same circuit or the level
 * matching would be measuring something the listener never hears.
 */
function makeVoicing(ctx, sys, airCompDb = 0) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = sys.hp[0];
  hp.Q.value = sys.hp[1];

  let node = hp;
  for (const [f, q, g, type] of sys.bands) {
    const pk = ctx.createBiquadFilter();
    pk.type = type || 'peaking';
    pk.frequency.value = f;
    pk.Q.value = q;
    pk.gain.value = g;
    node.connect(pk);
    node = pk;
  }

  // Long-throw high-frequency compensation. A system engineer working a
  // stadium shelves the top end back up to replace what the walk through the
  // air will take out; without it a distant rig is just dull.
  if (airCompDb > 0.2) {
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5000;
    air.gain.value = airCompDb;
    node.connect(air);
    node = air;
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = sys.lp[0];
  lp.Q.value = sys.lp[1];
  node.connect(lp);

  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  shaper.curve = driveCurve(sys.drive ?? 0);
  lp.connect(shaper);

  return { input: hp, output: shaper };
}

/** Two convolvers fed from a stereo signal, one per loudspeaker. */
function makeRoom(ctx, buffers) {
  const stereoise = ctx.createGain();
  stereoise.channelCount = 2;
  stereoise.channelCountMode = 'explicit';
  stereoise.channelInterpretation = 'speakers';
  const splitter = ctx.createChannelSplitter(2);
  const convL = ctx.createConvolver();
  const convR = ctx.createConvolver();
  // Levels are set by measurement, not by the node's own normalisation, so
  // that A/B compares the sound rather than the volume.
  convL.normalize = false;
  convR.normalize = false;
  convL.buffer = buffers[0];
  convR.buffer = buffers[1];
  const sum = ctx.createGain();
  stereoise.connect(splitter);
  splitter.connect(convL, 0);
  splitter.connect(convR, 1);
  convL.connect(sum);
  convR.connect(sum);
  return { input: stereoise, output: sum };
}

/* ------------------------------------------------------- loudness matching */

/**
 * K-weighting from ITU-R BS.1770 — the filter broadcast loudness meters use.
 * Coefficients are specified at 48 kHz; both the treated and the bypassed
 * signal go through the same pair, so the small error at other sample rates
 * cancels out of the comparison.
 */
const K_SHELF_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const K_SHELF_A = [1, -1.69065929318241, 0.73248077421585];
const K_HPF_B = [1.0, -2.0, 1.0];
const K_HPF_A = [1, -1.99004745483398, 0.99007225036621];

function attachLoudnessMeter(ctx, node) {
  if (!ctx.createIIRFilter) return node;
  try {
    const shelf = ctx.createIIRFilter(K_SHELF_B, K_SHELF_A);
    const hpf = ctx.createIIRFilter(K_HPF_B, K_HPF_A);
    node.connect(shelf);
    shelf.connect(hpf);
    return hpf;
  } catch (_) {
    return node;
  }
}

/** Pink noise: the closest simple stand-in for the long-term spectrum of music. */
function pinkStereo(length, seed = 7) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  const chans = [new Float32Array(length), new Float32Array(length)];
  const s = [[0, 0, 0], [0, 0, 0]];
  let c0 = 0, c1 = 0, c2 = 0;
  for (let i = 0; i < length; i++) {
    // A shared component and an independent one per channel: records are
    // neither mono nor uncorrelated, and the two limits differ by ~3 dB.
    const w = rnd();
    c0 = 0.99765 * c0 + w * 0.0990460;
    c1 = 0.96300 * c1 + w * 0.2965164;
    c2 = 0.57000 * c2 + w * 1.0526913;
    const common = (c0 + c1 + c2 + w * 0.1848) * 0.16;
    for (let ch = 0; ch < 2; ch++) {
      const v = rnd();
      s[ch][0] = 0.99765 * s[ch][0] + v * 0.0990460;
      s[ch][1] = 0.96300 * s[ch][1] + v * 0.2965164;
      s[ch][2] = 0.57000 * s[ch][2] + v * 1.0526913;
      const own = (s[ch][0] + s[ch][1] + s[ch][2] + v * 0.1848) * 0.16;
      chans[ch][i] = clamp(0.7 * common + 0.7 * own, -1, 1);
    }
  }
  return chans;
}

function rmsWindow(buffer, fromSec, toSec) {
  const sr = buffer.sampleRate;
  const from = Math.max(0, Math.floor(fromSec * sr));
  const to = Math.min(buffer.length, Math.floor(toSec * sr));
  if (to <= from) return 0;
  let sum = 0, n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = from; i < to; i++) { sum += d[i] * d[i]; n++; }
  }
  return Math.sqrt(sum / Math.max(n, 1));
}

/* ------------------------------------------------------------------ engine */

export class SoundStage {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.bypassed = false;
    this.source = null;      // active AudioNode feeding the chain
    this.mediaEl = null;     // <audio> when playing a file
    this.stream = null;      // MediaStream when capturing
    this.venue = null;
    this.sys = null;
    this.airCompDb = 0;
    this.render = null;      // last render report, for the UI
    this.loadSeq = 0;
    this.noise = null;       // calibration noise, built once per sample rate
    this.dryLevel = 0;
    this.meterBuf = null;
  }

  /** Create or wake the audio context. Must be called from a user gesture the first time. */
  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'playback' });
      this.buildGraph();
    }
    // iOS reports 'interrupted' after a phone call or a trip to another app,
    // which is not 'suspended' — resume on anything that is not running.
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (_) {}
    }
    return this.ctx;
  }

  buildGraph() {
    const ctx = this.ctx;

    this.input = ctx.createGain();

    // Bypass leg — the untreated signal, for A/B.
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0;

    this.voicingIn = ctx.createGain();
    this.roomTrim = ctx.createGain();
    this.roomTrim.gain.value = 0;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 1;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.meterBuf = new Float32Array(this.analyser.fftSize);

    this.input.connect(this.dryGain);
    this.input.connect(this.voicingIn);
    this.roomTrim.connect(this.wetGain);
    this.wetGain.connect(this.master);
    this.dryGain.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    // The meter reads perceived level, not raw amplitude: it sees the output
    // through the same K-weighting the level matching uses, so a rig with a big
    // low end does not just peg the meter.
    attachLoudnessMeter(ctx, this.limiter).connect(this.analyser);

    this.voicing = null;
    this.room = null;
    this.ready = true;
  }

  /* ---------------------------------------------------------------- sources */

  disconnectSource() {
    if (this.source) { try { this.source.disconnect(); } catch (_) {} }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.mediaEl) {
      this.mediaEl.pause();
      this.mediaEl.removeAttribute('src');
      this.mediaEl.load();
      URL.revokeObjectURL(this.mediaUrl);
      this.mediaEl.remove();
      this.mediaEl = null;
      this.mediaUrl = null;
    }
    this.source = null;
  }

  async useFile(file) {
    await this.start();
    this.disconnectSource();
    const el = new Audio();
    this.mediaUrl = URL.createObjectURL(file);
    el.src = this.mediaUrl;
    el.preload = 'auto';
    // Some mobile browsers refuse to decode a media element that was never
    // attached to the document, so park it off-screen rather than detached.
    el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
    document.body.appendChild(el);
    this.mediaEl = el;
    this.source = this.ctx.createMediaElementSource(el);
    this.source.connect(this.input);
    try {
      await new Promise((res, rej) => {
        el.addEventListener('loadedmetadata', res, { once: true });
        el.addEventListener('error', () => rej(decodeError(file, el)), { once: true });
      });
    } catch (err) {
      this.disconnectSource();
      throw err;
    }
    return el;
  }

  /** Desktop only: process whatever a browser tab or the system is playing. */
  async useSystemAudio() {
    await this.start();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('This browser can’t capture other apps. Pick a song file instead.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No sound came through. Pick a tab and tick “Also share tab audio”.');
    }
    this.disconnectSource();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.input);
    return stream;
  }

  async useMicrophone() {
    await this.start();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.disconnectSource();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.input);
    return stream;
  }

  /* ----------------------------------------------------------------- venue */

  /**
   * Build a venue and swap it in. The new room is rendered and level-matched
   * while the old one keeps playing; the swap itself is a 25 ms dip. If a
   * newer request arrives meanwhile, this one is dropped rather than landing
   * late on top of it.
   */
  async loadVenue(venue, opts = {}) {
    await this.start();
    const seq = ++this.loadSeq;

    const { buffers, report } = await renderVenue(venue, { ...opts, sampleRate: this.ctx.sampleRate });
    if (seq !== this.loadSeq) return null;

    const sys = SYSTEMS[venue.system];
    // Capped: you can put six decibels back, not the thirteen the air took,
    // and a real rig would run out of headroom long before that too.
    const airCompDb = venue.airComp
      ? Math.min(6, AIR_ABSORPTION_DB_M[6] * report.distance * 0.75)
      : 0;

    const trim = await this.calibrate(sys, airCompDb, buffers) * dbToGain(venue.trimDb || 0);
    if (seq !== this.loadSeq) return null;

    const ctx = this.ctx;
    const voicing = makeVoicing(ctx, sys, airCompDb);
    const room = makeRoom(ctx, buffers);
    voicing.output.connect(room.input);

    // Fade, swap, fade back — one short dip instead of a click.
    const now = ctx.currentTime;
    this.wetGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(this.wetGain.gain.value, now);
    this.wetGain.gain.linearRampToValueAtTime(0, now + SWAP_FADE);
    await sleep(SWAP_FADE * 1000 + 10);
    if (seq !== this.loadSeq) return null;

    if (this.voicing) {
      try { this.voicingIn.disconnect(this.voicing.input); } catch (_) {}
      try { this.room.output.disconnect(this.roomTrim); } catch (_) {}
    }
    this.voicingIn.connect(voicing.input);
    room.output.connect(this.roomTrim);
    this.roomTrim.gain.setValueAtTime(trim, ctx.currentTime);
    this.voicing = voicing;
    this.room = room;

    const t = ctx.currentTime;
    this.wetGain.gain.cancelScheduledValues(t);
    this.wetGain.gain.setValueAtTime(0, t);
    this.wetGain.gain.linearRampToValueAtTime(this.bypassed ? 0 : 1, t + SWAP_FADE);

    this.venue = venue;
    this.sys = sys;
    this.airCompDb = airCompDb;
    this.render = { ...report, trim };
    return this.render;
  }

  /**
   * Find the gain that makes the treated path as loud as the bypassed one, by
   * playing pink noise through an exact copy of the chain and measuring both
   * with a broadcast loudness filter.
   *
   * Measured rather than calculated because the honest answer depends on the
   * spectrum of the material: a room with a long bass decay adds far more to a
   * bass-heavy record than a flat energy sum would suggest.
   */
  async calibrate(sys, airCompDb, buffers) {
    const sr = this.ctx.sampleRate;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) return 1;

    const NOISE_SEC = 3;
    const len = Math.ceil(NOISE_SEC * sr);
    if (!this.noise || this.noise.rate !== sr) {
      this.noise = { rate: sr, data: pinkStereo(len) };
      this.dryLevel = 0;
    }

    // The reverberant field is within 0.1 dB of steady state a third of the way
    // into the decay, so there is no need to wait for the whole response.
    const irSec = buffers[0].length / sr;
    const settle = Math.min(irSec / 3, 2);

    const measure = async (treated) => {
      const ctx = new OfflineCtx(2, len, sr);
      const buf = ctx.createBuffer(2, len, sr);
      buf.copyToChannel(this.noise.data[0], 0);
      buf.copyToChannel(this.noise.data[1], 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      let tail = src;
      if (treated) {
        const v = makeVoicing(ctx, sys, airCompDb);
        const r = makeRoom(ctx, buffers);
        src.connect(v.input);
        v.output.connect(r.input);
        tail = r.output;
      }
      attachLoudnessMeter(ctx, tail).connect(ctx.destination);
      src.start(0);
      return rmsWindow(await ctx.startRendering(), treated ? settle : 0.1, NOISE_SEC);
    };

    // The bypass level never changes for a given sample rate; measure it once.
    if (!this.dryLevel) this.dryLevel = await measure(false);
    const wet = await measure(true);
    return clamp(wet > 1e-9 ? this.dryLevel / wet : 1, 0.02, 64);
  }

  /* -------------------------------------------------------------- controls */

  setBypass(on) {
    this.bypassed = on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(on ? 0 : 1, now, 0.012);
    this.dryGain.gain.setTargetAtTime(on ? 1 : 0, now, 0.012);
  }

  setVolume(v) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(clamp(v, 0, 1.4), this.ctx.currentTime, RAMP);
  }

  outputLevel() {
    if (!this.analyser) return 0;
    const buf = this.meterBuf;
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeError(file, el) {
  const name = (file.name || '').toLowerCase();
  const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (safari && /\.(ogg|oga|opus|webm)$/.test(name)) {
    return new Error('Safari can’t play that format. Try an MP3, M4A, WAV or FLAC.');
  }
  const code = el.error?.code;
  if (code === 4) return new Error('That file isn’t a format this browser can play. MP3, M4A, WAV and FLAC all work.');
  return new Error('That file couldn’t be read. Try another one.');
}

/* ------------------------------------------------------------ room renders */

const cache = new Map();

/**
 * Render a venue's pair of binaural responses. Independent of any live audio
 * context, so the app can show a room's measurements before a note is played —
 * and before iOS will let it open an output at all.
 */
export async function renderVenue(venue, { quality = 1, sampleRate = 48000 } = {}) {
  const key = `${venue.id}|${quality}|${sampleRate}`;
  if (cache.has(key)) return cache.get(key);

  const listener = venue.listener;
  const irSeconds = Math.max(0.25, venue.irSeconds * quality);
  const started = now();

  // Both speakers are trimmed by the same amount — whichever reaches the
  // listener first — so the music starts the instant you press play while the
  // few hundred microseconds between the two speakers, which is what places the
  // stereo image, survive intact.
  const distances = venue.speakers.map((p) => Math.hypot(p[0] - listener[0], p[1] - listener[1], p[2] - listener[2]));
  const leadTrim = Math.min(...distances) / C_AIR;

  const reports = await Promise.all(venue.speakers.map((pos, i) => {
    const toListener = [listener[0] - pos[0], listener[1] - pos[1], listener[2] - pos[2]];
    const n = Math.hypot(toListener[0], toListener[1], toListener[2]) || 1;
    return renderSpeakerBRIR({
      dims: venue.dims,
      materials: venue.materials,
      listener,
      yaw: 0,
      source: pos,
      aim: [toListener[0] / n, toListener[1] / n, toListener[2] / n],
      spread: venue.spread ?? 1,
      diffuse: venue.diffuse ?? 1,
      rt60Override: venue.rt60Override ?? null,
      diffuseRefDb: venue.diffuseRefDb ?? null,
      directivityP: venue.cardioidSubs ? CARDIOID_SUB_P : DIRECTIVITY_P,
      sampleRate,
      irSeconds,
      leadTrim,
      seed: 0x5eed + i * 7717 + venue.id.length * 131,
    });
  }));

  const buffers = reports.map((r) => r.buffer);
  const out = {
    buffers,
    report: {
      venue: venue.id,
      rt60: reports[0].rt60,
      tMix: reports[0].tMix,
      t0: reports[0].t0,
      onset: reports[0].onset,
      reflections: reports[0].reflections,
      order: reports[0].order,
      irSeconds,
      sampleRate,
      distance: distances[0],
      buildMs: Math.round(now() - started),
      decay: decayCurve(buffers[0]),
    },
  };
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Energy-decay curve of an impulse response, in dB, downsampled for drawing.
 * This is the reflectogram the app plots: the actual response it just built,
 * not an illustration of one.
 */
function decayCurve(buffer, points = 400) {
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const hop = Math.max(1, Math.floor(L.length / points));
  const out = [];
  let peak = 1e-12;
  for (let i = 0; i + hop <= L.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += L[j] * L[j] + R[j] * R[j];
    const rms = Math.sqrt(e / (2 * hop));
    if (rms > peak) peak = rms;
    out.push(rms);
  }
  return {
    db: out.map((v) => Math.max(-70, 20 * Math.log10(v / peak))),
    seconds: buffer.length / buffer.sampleRate,
  };
}
