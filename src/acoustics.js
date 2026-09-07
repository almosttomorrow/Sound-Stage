/**
 * acoustics.js — physical constants, material data and room-acoustics maths.
 *
 * Everything downstream works in seven octave bands centred on
 * 125 / 250 / 500 / 1k / 2k / 4k / 8k Hz. That is the resolution real
 * acoustic measurements are published at, so the material tables below are
 * the published numbers rather than invented curves.
 */

export const C_AIR = 343;          // speed of sound, m/s, 20 °C
export const HEAD_RADIUS = 0.0875; // m — standard spherical-head radius

export const BAND_CENTRES = [125, 250, 500, 1000, 2000, 4000, 8000];
export const NBANDS = BAND_CENTRES.length;

/** Linkwitz-Riley crossover points sitting between the octave centres. */
export const BAND_EDGES = [176.8, 353.6, 707.1, 1414.2, 2828.4, 5656.9];

/**
 * Atmospheric absorption, dB per metre, 20 °C / 50 % RH (ISO 9613-1).
 * Only matters in the big rooms — across a stadium it removes ~12 dB at 8 kHz,
 * which is exactly why distant PA sounds dull.
 */
export const AIR_ABSORPTION_DB_M = [0.0004, 0.001, 0.0019, 0.0037, 0.0097, 0.033, 0.117];

/**
 * Sabine absorption coefficients per octave band.
 * Sources: standard architectural-acoustics tables (Cox & D'Antonio, Vorlander).
 */
export const MATERIALS = {
  stone:      { name: 'Dressed stone',   a: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03], s: [0.05, 0.08, 0.10, 0.14, 0.18, 0.22, 0.25] },
  plaster:    { name: 'Plaster on brick',a: [0.02, 0.02, 0.03, 0.04, 0.05, 0.05, 0.06], s: [0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18] },
  concrete:   { name: 'Sealed concrete', a: [0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.04], s: [0.03, 0.05, 0.07, 0.09, 0.11, 0.13, 0.15] },
  brick:      { name: 'Bare brick',      a: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07, 0.08], s: [0.08, 0.12, 0.16, 0.20, 0.24, 0.28, 0.30] },
  gypsum:     { name: 'Plasterboard',    a: [0.29, 0.10, 0.05, 0.04, 0.07, 0.09, 0.10], s: [0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.14] },
  woodPanel:  { name: 'Wood panelling',  a: [0.19, 0.14, 0.09, 0.06, 0.06, 0.05, 0.05], s: [0.10, 0.14, 0.18, 0.22, 0.26, 0.30, 0.32] },
  woodFloor:  { name: 'Wood floor',      a: [0.15, 0.11, 0.10, 0.07, 0.06, 0.07, 0.07], s: [0.05, 0.07, 0.09, 0.11, 0.13, 0.15, 0.17] },
  carpet:     { name: 'Heavy carpet',    a: [0.08, 0.24, 0.57, 0.69, 0.71, 0.73, 0.75], s: [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40] },
  shelvedWall:{ name: 'Full bookshelves and curtains', a: [0.30, 0.34, 0.32, 0.30, 0.30, 0.32, 0.34], s: [0.35, 0.45, 0.55, 0.65, 0.70, 0.75, 0.78] },
  glass:      { name: 'Window glass',    a: [0.35, 0.25, 0.18, 0.12, 0.07, 0.04, 0.04], s: [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08] },
  acoustic:   { name: 'Acoustic treatment', a: [0.30, 0.60, 0.85, 0.95, 0.95, 0.90, 0.88], s: [0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.60] },
  audience:   { name: 'Seated audience', a: [0.39, 0.57, 0.80, 0.94, 0.92, 0.87, 0.85], s: [0.30, 0.40, 0.50, 0.60, 0.65, 0.70, 0.70] },
  pews:       { name: 'Empty wooden pews', a: [0.10, 0.09, 0.08, 0.08, 0.08, 0.08, 0.08], s: [0.25, 0.35, 0.45, 0.50, 0.55, 0.60, 0.60] },
  naveFloor:  { name: 'Pews, aisle runner, small congregation', a: [0.16, 0.17, 0.19, 0.21, 0.23, 0.25, 0.26], s: [0.25, 0.35, 0.45, 0.50, 0.55, 0.60, 0.60] },
  clubCeiling:{ name: 'Treated club ceiling', a: [0.12, 0.20, 0.28, 0.32, 0.34, 0.32, 0.30], s: [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.65] },
  clubFloor:  { name: 'Packed dance floor',  a: [0.22, 0.38, 0.52, 0.60, 0.64, 0.66, 0.67], s: [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.65] },
  softFurn:   { name: 'Sofa & soft furnishing', a: [0.20, 0.35, 0.50, 0.58, 0.62, 0.65, 0.66], s: [0.25, 0.35, 0.45, 0.50, 0.55, 0.60, 0.60] },
  grass:      { name: 'Grass pitch',     a: [0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85], s: [0.30, 0.40, 0.50, 0.60, 0.65, 0.70, 0.70] },
  openSky:    { name: 'Open to sky',     a: [1, 1, 1, 1, 1, 1, 1],                      s: [0, 0, 0, 0, 0, 0, 0] },
  carTrim:    { name: 'Car trim',        a: [0.25, 0.40, 0.55, 0.65, 0.70, 0.72, 0.74], s: [0.20, 0.30, 0.40, 0.45, 0.50, 0.55, 0.55] },
  steelDeck:  { name: 'Steel deck',      a: [0.05, 0.04, 0.03, 0.03, 0.03, 0.03, 0.03], s: [0.10, 0.14, 0.18, 0.22, 0.26, 0.30, 0.32] },
};

export const SURFACES = ['xMin', 'xMax', 'yMin', 'yMax', 'floor', 'ceiling'];

/** Per-surface, per-band pressure reflection coefficient beta = sqrt(1 - alpha). */
export function reflectionCoefficients(materials) {
  return SURFACES.map((face) => {
    const m = MATERIALS[materials[face]];
    if (!m) throw new Error(`Unknown material for ${face}: ${materials[face]}`);
    return m.a.map((a) => Math.sqrt(Math.max(0, 1 - a)));
  });
}

/** Per-surface, per-band scattering coefficient — how much specular energy is diffused. */
export function scatterCoefficients(materials) {
  return SURFACES.map((face) => MATERIALS[materials[face]].s.slice());
}

export function surfaceAreas([Lx, Ly, Lz]) {
  // Order matches SURFACES.
  return [Ly * Lz, Ly * Lz, Lx * Lz, Lx * Lz, Lx * Ly, Lx * Ly];
}

/**
 * Reverberation time per band, Eyring form with an air-absorption term.
 * Eyring rather than Sabine because several of these rooms are very absorbent
 * (a stadium is mostly open sky) and Sabine badly overestimates there.
 */
export function reverbTimes(dims, materials) {
  const [Lx, Ly, Lz] = dims;
  const V = Lx * Ly * Lz;
  const areas = surfaceAreas(dims);
  const S = areas.reduce((t, a) => t + a, 0);

  return BAND_CENTRES.map((_, b) => {
    let absorbed = 0;
    SURFACES.forEach((face, i) => { absorbed += areas[i] * MATERIALS[materials[face]].a[b]; });
    const meanAlpha = Math.min(0.995, absorbed / S);
    const m = AIR_ABSORPTION_DB_M[b] / 8.686; // dB/m -> nepers/m
    const denom = -S * Math.log(1 - meanAlpha) + 4 * m * V;
    return denom > 1e-6 ? Math.min(12, (0.161 * V) / denom) : 0.05;
  });
}

/**
 * Mixing time — where discrete reflections give way to a diffuse tail.
 * Polack's V-based estimate; used as the crossover between the image-source
 * model and the stochastic tail.
 */
export function mixingTime(dims) {
  const V = dims[0] * dims[1] * dims[2];
  return Math.min(0.25, Math.max(0.012, (2 * Math.sqrt(V)) / 1000));
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpVec = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
export const dbToGain = (db) => Math.pow(10, db / 20);
