/**
 * venues.js — the rooms.
 *
 * Every venue is a real shoebox in metres with real surface materials, a real
 * loudspeaker position and a real seat. Nothing here is a reverb preset with a
 * decay-time knob: change a dimension or a wall covering and the sound changes
 * the way the physics says it should. The reverberation times printed in the
 * app are computed from these numbers, not typed in.
 *
 * Coordinates: x runs from the back of the room towards the stage, y across it,
 * z upwards, with the corner of the room at the origin. The listener faces +x,
 * so their left ear points towards +y.
 *
 * Each room states one listening position rather than offering a slider. There
 * is an obvious place to stand in every one of these rooms — the sweet spot in
 * a control room, the middle of the bowl in a stadium — and choosing it is the
 * app's job, not the listener's.
 */

/**
 * Loudspeaker voicings, applied to the signal *before* the room — the same
 * order as reality: amplifier and cabinet first, then the air.
 *   hp/lp      corner frequencies and Q of the system's band limits
 *   bands      peaking EQ sections, [freq, Q, gain dB]
 *   drive      soft-clip amount, 0-1; big rigs are never quite clean
 */
export const SYSTEMS = {
  monitors: {
    name: 'Nearfield monitors',
    hp: [42, 0.8], lp: [21000, 0.7],
    bands: [[2600, 1.1, 0.6]],
    drive: 0.0,
  },
  bookshelf: {
    name: 'Hi-fi bookshelf pair',
    hp: [52, 0.9], lp: [19000, 0.7],
    bands: [[95, 1.0, 1.6], [1500, 0.9, -1.0], [7000, 0.8, 1.4]],
    drive: 0.02,
  },
  clubPA: {
    name: 'Small club PA',
    hp: [58, 0.9], lp: [15000, 0.7],
    bands: [[140, 1.2, 2.0], [420, 1.0, -1.8], [3200, 1.0, 2.2]],
    drive: 0.10,
  },
  columnPA: {
    name: 'Column array + house organ loft',
    hp: [92, 0.9], lp: [10500, 0.7],
    bands: [[260, 1.1, -2.4], [1900, 0.9, 2.6], [5200, 1.0, -2.0]],
    drive: 0.07,
  },
  hallRig: {
    name: 'Discreet reinforcement',
    hp: [40, 0.8], lp: [18000, 0.7],
    bands: [[220, 1.0, -0.8], [3400, 0.9, 1.0]],
    drive: 0.01,
  },
  soundSystem: {
    name: 'Stacked club rig, horn-loaded subs',
    hp: [28, 0.7], lp: [16500, 0.7],
    bands: [[48, 1.1, 5.0], [95, 1.3, 2.4], [380, 1.1, -3.0], [2800, 1.0, 2.0]],
    drive: 0.30,
  },
  lineArray: {
    name: 'Flown line array + ground subs',
    hp: [36, 0.8], lp: [16000, 0.7],
    bands: [[55, 1.0, 3.6], [300, 1.1, -2.6], [2400, 0.9, 2.8], [9000, 0.8, 1.6]],
    drive: 0.16,
  },
  carDoors: {
    name: 'Factory door speakers',
    hp: [74, 1.1], lp: [13000, 0.7],
    bands: [[120, 1.4, 2.6], [340, 1.2, -4.0], [4200, 1.1, 2.8]],
    drive: 0.11,
  },
};

export const VENUES = [
  {
    id: 'studio',
    name: 'Control Room',
    place: 'Treated studio, 6.5 × 4.8 m',
    note: 'The reference. Almost no room — this is roughly what the mix engineer heard.',
    system: 'monitors',
    dims: [6.5, 4.8, 3.0],
    materials: { xMin: 'acoustic', xMax: 'acoustic', yMin: 'acoustic', yMax: 'gypsum', floor: 'woodFloor', ceiling: 'acoustic' },
    listener: [3.0, 2.4, 1.2],
    spot: 'In the sweet spot, 1.6 m back',
    speakers: [[4.5, 3.05, 1.25], [4.5, 1.75, 1.25]],
    spread: 1.0, irSeconds: 0.6, trimDb: 0,
  },
  {
    id: 'living',
    name: 'Living Room',
    place: 'Carpeted lounge, 7.5 × 5.0 m',
    note: 'Two good bookshelf speakers, a sofa behind you, a window down one side.',
    system: 'bookshelf',
    dims: [7.5, 5.0, 2.7],
    materials: { xMin: 'softFurn', xMax: 'gypsum', yMin: 'glass', yMax: 'gypsum', floor: 'carpet', ceiling: 'gypsum' },
    listener: [2.9, 2.5, 1.15],
    spot: 'On the sofa, 3.2 m back',
    speakers: [[5.9, 3.7, 1.05], [5.9, 1.3, 1.05]],
    spread: 1.0, irSeconds: 0.9, trimDb: 0,
  },
  {
    id: 'jazz',
    name: 'Jazz Club',
    place: 'Brick basement, 12 × 9 m',
    note: 'Low ceiling, bare brick, a small PA barely two tables away.',
    system: 'clubPA',
    dims: [12, 9, 3.2],
    materials: { xMin: 'audience', xMax: 'brick', yMin: 'brick', yMax: 'woodPanel', floor: 'woodFloor', ceiling: 'acoustic' },
    listener: [6.2, 4.5, 1.15],
    spot: 'Two tables back, 4.5 m from the stack',
    speakers: [[10.2, 6.3, 2.05], [10.2, 2.7, 2.05]],
    spread: 1.15, irSeconds: 1.0, trimDb: 0,
  },
  {
    id: 'hall',
    name: 'Concert Hall',
    place: 'Shoebox hall, 45 × 22 × 17 m',
    note: 'Plaster and wood, a full house, the long even decay these rooms are built for.',
    system: 'hallRig',
    dims: [45, 22, 17],
    materials: { xMin: 'woodPanel', xMax: 'woodPanel', yMin: 'woodPanel', yMax: 'plaster', floor: 'audience', ceiling: 'plaster' },
    listener: [23, 11, 1.35],
    spot: 'Mid-stalls, 18 m from the stage',
    speakers: [[41, 14.6, 3.2], [41, 7.4, 3.2]],
    spread: 1.0, irSeconds: 3.7, trimDb: 0,
  },
  {
    id: 'church',
    name: 'Stone Church',
    place: 'Stone nave, 30 × 14 × 15 m',
    note: 'Stained glass, a hard floor and five seconds of tail. Everything blurs into everything.',
    system: 'columnPA',
    dims: [30, 14, 15],
    materials: { xMin: 'woodPanel', xMax: 'stone', yMin: 'glass', yMax: 'plaster', floor: 'naveFloor', ceiling: 'plaster' },
    listener: [15, 7, 1.3],
    spot: 'Halfway down the nave, 12 m back',
    speakers: [[26.5, 9.6, 4.2], [26.5, 4.4, 4.2]],
    spread: 1.25, irSeconds: 5.0, trimDb: 0,
  },
  {
    id: 'club',
    name: 'Nightclub',
    place: 'Concrete room, 24 × 16 m',
    note: 'Horn-loaded subs, a steel ceiling and a floor full of people soaking up the top.',
    system: 'soundSystem',
    dims: [24, 16, 5.5],
    materials: { xMin: 'audience', xMax: 'concrete', yMin: 'concrete', yMax: 'brick', floor: 'clubFloor', ceiling: 'steelDeck' },
    listener: [13, 8, 1.6],
    spot: 'Out on the floor, 9 m from the stacks',
    speakers: [[21.5, 11.6, 2.6], [21.5, 4.4, 2.6]],
    // Driven this hard the rig reads louder than a K-weighted match predicts:
    // heavy soft clipping raises density as much as level. Trimmed by ear.
    spread: 1.3, irSeconds: 2.5, trimDb: -2,
  },
  {
    id: 'stadium',
    name: 'Stadium',
    place: 'Open bowl, 190 × 140 m',
    note: 'Ninety metres of air between you and the arrays. The top end never survives the trip.',
    system: 'lineArray',
    dims: [190, 140, 38],
    materials: { xMin: 'audience', xMax: 'audience', yMin: 'audience', yMax: 'audience', floor: 'grass', ceiling: 'openSky' },
    listener: [95, 70, 2],
    spot: 'Middle of the bowl, 67 m from the arrays',
    speakers: [[150, 100, 27], [150, 40, 27]],
    spread: 1.7, irSeconds: 3.0, trimDb: 0,
  },
  {
    id: 'field',
    name: 'Open Air Field',
    place: 'Festival ground, no walls',
    note: 'Nothing to reflect off but the grass. Just distance, air and the ground bounce.',
    system: 'lineArray',
    dims: [300, 300, 120],
    materials: { xMin: 'openSky', xMax: 'openSky', yMin: 'openSky', yMax: 'openSky', floor: 'grass', ceiling: 'openSky' },
    listener: [160, 150, 1.65],
    spot: 'In the crowd, 74 m from the stage',
    speakers: [[232, 166, 8.5], [232, 134, 8.5]],
    spread: 1.7, irSeconds: 1.3, trimDb: 0,
    // No walls means no reverberant field. What little decay there is comes off
    // the crowd and the distant site structures, so it is stated rather than
    // derived — Eyring has nothing to work with out here.
    diffuse: 1,
    rt60Override: [0.80, 0.68, 0.55, 0.44, 0.34, 0.25, 0.18],
    diffuseRefDb: -21,
  },
  {
    id: 'car',
    name: 'Car',
    place: 'Saloon cabin, 2.4 × 1.6 m',
    note: 'Door speakers a foot from one ear and three feet from the other. Nothing is centred.',
    system: 'carDoors',
    dims: [2.4, 1.6, 1.15],
    materials: { xMin: 'carTrim', xMax: 'glass', yMin: 'glass', yMax: 'glass', floor: 'carpet', ceiling: 'carTrim' },
    listener: [0.85, 0.48, 0.82],
    spot: "Driver's seat — nothing is centred",
    speakers: [[1.62, 1.46, 0.32], [1.62, 0.14, 0.32]],
    spread: 1.1, irSeconds: 0.3, trimDb: 0,
  },
];

export const venueById = (id) => VENUES.find((v) => v.id === id) || VENUES[1];
