/**
 * app.js — interface wiring.
 *
 * Everything the page shows about a room is measured from the response the app
 * has just built: the decay curve is that impulse response, the reverb time is
 * its Eyring decay. Nothing here is illustrative.
 */

import { VENUES, venueById, SYSTEMS } from './venues.js';
import { SoundStage, renderVenue } from './engine.js';
import { reverbTimes, clamp } from './acoustics.js';

const $ = (id) => document.getElementById(id);

const stage = new SoundStage();
const state = {
  venue: venueById('living'),
  quality: 1,
  volume: 0.85,
  bypass: false,
  report: null,
  playing: false,
};

const isTouch = window.matchMedia('(pointer: coarse)').matches;

/* ------------------------------------------------------------------ toast */

let toastTimer;
function say(message, ms = 3600) {
  const el = $('status');
  el.textContent = message;
  el.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.dataset.show = 'false'; }, ms);
}

/* ------------------------------------------------------------- venue tiles */

function midDecay(v) {
  const rt = v.rt60Override || reverbTimes(v.dims, v.materials);
  return (rt[2] + rt[3]) / 2;
}

const fmtSeconds = (t) => (t < 1 ? t.toFixed(2) : t.toFixed(1));

function buildVenueTiles() {
  const host = $('venues');
  host.innerHTML = '';
  for (const v of VENUES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'venue';
    b.setAttribute('aria-pressed', String(v.id === state.venue.id));
    b.dataset.id = v.id;
    b.innerHTML = `<h3>${v.name}</h3><span class="rt">${fmtSeconds(midDecay(v))} s reverb</span>`;
    b.addEventListener('click', () => selectVenue(v.id));
    host.appendChild(b);
  }
}

function setTileBusy(id, busy) {
  for (const el of document.querySelectorAll('.venue')) {
    el.classList.toggle('building', busy && el.dataset.id === id);
  }
}

/* -------------------------------------------------------------- rendering */

let renderToken = 0;
let pending = null;

async function refreshRoom() {
  const token = ++renderToken;
  const venue = state.venue;
  $('plot').classList.add('busy');
  setTileBusy(venue.id, true);

  try {
    const opts = { quality: state.quality };
    const report = stage.ready
      ? await stage.loadVenue(venue, opts)
      : (await renderVenue(venue, { ...opts, sampleRate: 48000 })).report;
    if (token !== renderToken || !report) return;
    state.report = report;
    paintRoom(report);
  } catch (err) {
    console.error(err);
    say('That room couldn’t be built on this device.');
  } finally {
    if (token === renderToken) {
      $('plot').classList.remove('busy');
      setTileBusy(venue.id, false);
    }
  }
}

function scheduleRefresh(delay = 0) {
  clearTimeout(pending);
  pending = setTimeout(refreshRoom, delay);
}

function selectVenue(id) {
  state.venue = venueById(id);
  for (const el of document.querySelectorAll('.venue')) {
    el.setAttribute('aria-pressed', String(el.dataset.id === id));
  }
  paintVenueText();
  scheduleRefresh(0);
}

function paintVenueText() {
  const v = state.venue;
  $('room-name').textContent = v.name;
  $('room-place').textContent = v.place;
  $('room-note').textContent = v.note;
  $('room-spot').textContent = v.spot;
  $('r-sys').textContent = SYSTEMS[v.system].name;
}

/* ------------------------------------------------------------- room paint */

function paintRoom(report) {
  const rtMid = (report.rt60[2] + report.rt60[3]) / 2;
  $('r-rt').innerHTML = `${fmtSeconds(rtMid)}<small> s</small>`;

  // One thing worth knowing about every room, taken from its own numbers:
  // low frequencies almost always outlast high ones, and by how much is most
  // of what separates a warm room from a bright one.
  const ratio = report.rt60[0] / Math.max(report.rt60[6], 0.01);
  $('lesson').innerHTML = ratio >= 1.2
    ? `Bass notes linger <b>${ratio.toFixed(1)}×</b> longer than treble in here.`
    : 'Bass and treble fade at about the same rate in here.';

  drawDecay(report);
}

/* ---------------------------------------------------------- reflectogram */

const canvas = $('decay');
const cx = canvas.getContext('2d');

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawDecay(report) {
  if (!report) return;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 560;
  const h = 130;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, w, h);

  const padL = 26, padR = 4, padT = 6, padB = 16;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const { db, seconds } = report.decay;
  const FLOOR = -70;

  const x = (t) => padL + (t / seconds) * plotW;
  const y = (d) => padT + (1 - (d - FLOOR) / -FLOOR) * plotH;

  const muted = css('--muted') || '#888';
  const line = css('--line-soft') || '#ddd';
  const direct = css('--direct') || '#4fc8d9';
  const tail = css('--tail') || '#e4703a';

  cx.strokeStyle = line;
  cx.lineWidth = 1;
  cx.font = "9px 'IBM Plex Mono', monospace";
  cx.fillStyle = muted;
  cx.textAlign = 'right';
  for (const d of [0, -20, -40, -60]) {
    const yy = Math.round(y(d)) + 0.5;
    cx.beginPath(); cx.moveTo(padL, yy); cx.lineTo(w - padR, yy); cx.stroke();
    cx.fillText(`${d}`, padL - 5, yy + 3);
  }

  cx.textAlign = 'center';
  const step = seconds > 3 ? 1 : seconds > 1.2 ? 0.5 : seconds > 0.5 ? 0.2 : 0.1;
  for (let t = step; t < seconds; t += step) {
    cx.fillText(`${t < 1 ? t.toFixed(1) : t}s`, x(t), h - 4);
  }

  // The handover from traced reflections to the diffuse tail — the same split
  // the synthesis uses, so the two colours mean exactly what the legend says.
  const tSplit = Math.min(seconds, report.onset + report.tMix);
  const n = db.length;
  const pt = (i) => [x((i / n) * seconds), y(db[i])];

  const drawSeg = (from, to, colour) => {
    if (to <= from) return;
    cx.beginPath();
    cx.moveTo(...pt(from));
    for (let i = from + 1; i <= to && i < n; i++) cx.lineTo(...pt(i));
    const last = Math.min(to, n - 1);
    cx.lineTo(x((last / n) * seconds), y(FLOOR));
    cx.lineTo(x((from / n) * seconds), y(FLOOR));
    cx.closePath();
    cx.fillStyle = colour;
    cx.globalAlpha = 0.18;
    cx.fill();
    cx.globalAlpha = 1;
    cx.beginPath();
    cx.moveTo(...pt(from));
    for (let i = from + 1; i <= to && i < n; i++) cx.lineTo(...pt(i));
    cx.strokeStyle = colour;
    cx.lineWidth = 1.4;
    cx.stroke();
  };

  // In a big room the traced reflections occupy a sliver of the time axis.
  // Tint the region rather than distorting the scale, so the split stays
  // legible without lying about how brief it is.
  const iSplit = Math.round((tSplit / seconds) * n);
  cx.fillStyle = direct;
  cx.globalAlpha = 0.07;
  cx.fillRect(padL, padT, Math.max(2, x(tSplit) - padL), plotH);
  cx.globalAlpha = 1;

  drawSeg(0, iSplit, direct);
  drawSeg(Math.max(0, iSplit - 1), n - 1, tail);

  const xs = Math.round(x(tSplit)) + 0.5;
  cx.strokeStyle = direct;
  cx.globalAlpha = 0.55;
  cx.beginPath(); cx.moveTo(xs, padT); cx.lineTo(xs, padT + plotH); cx.stroke();
  cx.globalAlpha = 1;

  cx.fillStyle = muted;
  cx.textAlign = 'right';
  cx.fillText('dB', padL - 5, padT + 3);
}

/* -------------------------------------------------------------- controls */

$('vol').addEventListener('input', (e) => {
  state.volume = Number(e.target.value) / 100;
  $('vol-val').textContent = `${e.target.value} %`;
  if (stage.ready) stage.setVolume(state.volume);
});

$('quality').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-q]');
  if (!btn) return;
  state.quality = Number(btn.dataset.q);
  for (const b of $('quality').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
  scheduleRefresh(0);
});

/* ------------------------------------------------------------------- A/B */

const ab = $('ab');
function setBypass(on) {
  if (!stage.ready) return;
  state.bypass = on;
  stage.setBypass(on);
  ab.dataset.on = String(on);
  ab.textContent = on ? 'Original — no room' : 'Hold to hear the original';
}
ab.addEventListener('pointerdown', (e) => { e.preventDefault(); setBypass(true); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
  ab.addEventListener(ev, () => setBypass(false)));
ab.addEventListener('contextmenu', (e) => e.preventDefault());
ab.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setBypass(true); }
});
ab.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') setBypass(false);
});

/* ---------------------------------------------------------------- sources */

async function afterSourceReady(kind, name) {
  ab.disabled = false;
  $('now').hidden = false;
  $('now-kind').textContent = kind;
  $('now-name').textContent = name;
  $('transport').style.display = stage.mediaEl ? '' : 'none';
  $('pick-file').textContent = 'Choose a different song';
  $('pick-file').classList.remove('primary');
  stage.setVolume(state.volume);
  stage.setBypass(state.bypass);
  await refreshRoom();
  meterLoop();
}

async function loadFile(file) {
  if (!file) return;
  try {
    say('Opening the song…', 1500);
    const el = await stage.useFile(file);
    $('now-name').textContent = file.name.replace(/\.[^.]+$/, '');
    wireTransport(el);
    await afterSourceReady('Song', $('now-name').textContent);
    await tryPlay(el);
  } catch (err) {
    console.warn(err.message);
    say(err.message || 'That song couldn’t be played.');
  }
}

/** Autoplay rules differ by browser; if play is refused, the play button is right there. */
async function tryPlay(el) {
  try {
    await stage.start();
    await el.play();
    setPlaying(true);
  } catch (err) {
    setPlaying(false);
    if (err?.name === 'NotAllowedError') say('Tap play to start.');
    else throw err;
  }
}

// Waking the audio engine on the button tap — a guaranteed user gesture —
// rather than on the file picker's change event, which some browsers do not
// count as one.
$('pick-file').addEventListener('click', () => {
  stage.start().catch(() => {});
  $('file-input').click();
});
$('file-input').addEventListener('change', (e) => {
  loadFile(e.target.files?.[0]);
  e.target.value = '';
});

$('pick-capture').addEventListener('click', async () => {
  try {
    await stage.useSystemAudio();
    await afterSourceReady('Browser tab', 'Whatever that tab is playing');
    say('That tab now plays through the room.');
  } catch (err) {
    console.error(err);
    if (err.name !== 'NotAllowedError') say(err.message || 'Couldn’t capture that tab.');
  }
});

$('pick-mic').addEventListener('click', async () => {
  try {
    await stage.useMicrophone();
    await afterSourceReady('Live', 'Microphone or line input');
    say('Live input is on. Keep the volume sensible.');
  } catch (err) {
    console.error(err);
    if (err.name !== 'NotAllowedError') say('No input device was found.');
  }
});

// Drag a file anywhere on the page.
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dropping'); });
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/i.test(f.name));
  if (file) { stage.start().catch(() => {}); loadFile(file); }
  else say('Drop a song file — MP3, M4A, WAV or FLAC.');
});

/* ------------------------------------------------------------- transport */

const PLAY_PATH = 'M3 1.5 14 8 3 14.5z';
const PAUSE_PATH = 'M3 2h3.6v12H3zM9.4 2H13v12H9.4z';

function setPlaying(on) {
  state.playing = on;
  $('play-icon').firstElementChild?.setAttribute('d', on ? PAUSE_PATH : PLAY_PATH);
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  if (on) meterLoop();
}

function fmt(t) {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

let scrubbing = false;

function wireTransport(el) {
  const toggle = async () => {
    if (el.paused) await tryPlay(el);
    else { el.pause(); setPlaying(false); }
  };
  $('play').onclick = toggle;
  el.addEventListener('timeupdate', () => {
    if (scrubbing || !el.duration) return;
    $('scrub').value = String(Math.round((el.currentTime / el.duration) * 1000));
    $('time').textContent = `${fmt(el.currentTime)} / ${fmt(el.duration)}`;
  });
  el.addEventListener('ended', () => setPlaying(false));
  el.addEventListener('pause', () => setPlaying(false));
  el.addEventListener('play', () => setPlaying(true));
  $('scrub').oninput = (e) => {
    scrubbing = true;
    if (el.duration) $('time').textContent = `${fmt((Number(e.target.value) / 1000) * el.duration)} / ${fmt(el.duration)}`;
  };
  $('scrub').onchange = (e) => {
    scrubbing = false;
    if (el.duration) el.currentTime = (Number(e.target.value) / 1000) * el.duration;
  };

  // Lock-screen and headphone-button controls, and a hint to the phone that
  // this is music rather than a sound effect.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: $('now-name').textContent || 'Sound Stage',
        artist: `Sound Stage · ${state.venue.name}`,
      });
      navigator.mediaSession.setActionHandler('play', () => tryPlay(el));
      navigator.mediaSession.setActionHandler('pause', () => { el.pause(); setPlaying(false); });
      navigator.mediaSession.setActionHandler('seekbackward', () => { el.currentTime = Math.max(0, el.currentTime - 10); });
      navigator.mediaSession.setActionHandler('seekforward', () => { el.currentTime = Math.min(el.duration || 0, el.currentTime + 10); });
    } catch (_) {}
  }

  document.onkeydown = (e) => {
    if (e.key !== ' ' || e.target.closest('button, input, textarea, summary')) return;
    e.preventDefault();
    toggle();
  };
}

// Coming back from another app or a locked screen, the audio engine may have
// been put to sleep underneath a media element that thinks it is still playing.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stage.ctx && stage.mediaEl && !stage.mediaEl.paused) {
    stage.start().catch(() => {});
  }
});

/* ---------------------------------------------------------------- metering */

let metering = false;
function meterLoop() {
  if (metering) return;
  metering = true;
  const fill = $('meter');
  const tick = () => {
    if (!stage.ready) { metering = false; return; }
    const rms = stage.outputLevel();
    const db = 20 * Math.log10(Math.max(rms, 1e-5));
    const pct = clamp((db + 54) / 54, 0, 1) * 100;
    fill.style.height = `${pct.toFixed(1)}%`;
    fill.style.background = db > -2 ? css('--tail') : css('--direct');
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* -------------------------------------------------------------------- boot */

function boot() {
  // Only offer what this device can actually do.
  if (!navigator.mediaDevices?.getDisplayMedia) $('pick-capture').hidden = true;
  // A phone's microphone through headphones is not a use anyone wants, and on
  // Bluetooth it drops the whole headset into low-quality call mode.
  if (isTouch || !navigator.mediaDevices?.getUserMedia) $('pick-mic').hidden = true;

  buildVenueTiles();
  paintVenueText();
  $('transport').style.display = 'none';
  refreshRoom();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => drawDecay(state.report), 120);
  });
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => drawDecay(state.report));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.fonts?.ready.then(() => drawDecay(state.report)).catch(() => {});
boot();

// Handy from a console, and what the test harness drives.
window.soundStage = stage;
window.soundStageState = state;
