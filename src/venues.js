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
 * Every room is the best version of itself, not an average one: a system that
 * has actually been tuned, speakers hung and aimed properly, and a room with
 * the treatment a good example of it would have. The size, the distance and the
 * decay stay honest — a stadium is still ninety metres of air — but nothing here
 * is a badly rung PA in an untreated box. The point is to enjoy the room.
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
    name: 'Tuned nearfields',
    hp: [35, 0.7], lp: [22000, 0.7],
    bands: [[120, 0.8, 0.8], [3000, 0.9, 0.5]],
    drive: 0.0,
  },
  bookshelf: {
    name: 'Well-placed hi-fi pair',
    hp: [40, 0.75], lp: [21000, 0.7],
    bands: [[70, 0.9, 2.2], [280, 1.0, -1.4], [2800, 0.8, 0.8], [9000, 0.7, 1.6, 'highshelf']],
    drive: 0.015,
  },
  clubPA: {
    name: 'Tuned club PA with subs',
    hp: [42, 0.8], lp: [18500, 0.7],
    bands: [[80, 1.0, 2.6], [320, 1.1, -2.0], [2600, 0.9, 1.4], [8000, 0.7, 1.2, 'highshelf']],
    drive: 0.035,
  },
  columnPA: {
    // The best system a church can have. A digitally steered column throws a
    // tight vertical beam down the nave and barely touches the walls, so the
    // music stays defined while the room still blooms behind it. Subs are the
    // other half: a stone nave supports low end like nothing else, and a
    // system that stops at 90 Hz throws that away.
    name: 'Steered column array with subs',
    hp: [38, 0.75], lp: [18500, 0.7],
    bands: [[55, 1.0, 2.4], [315, 1.1, -2.8], [2500, 0.9, 2.0], [8000, 0.7, 1.8, 'highshelf']],
    drive: 0.015,
  },
  hallRig: {
    name: 'Discreet reinforcement',
    hp: [32, 0.7], lp: [21000, 0.7],
    bands: [[240, 1.0, -0.8], [3200, 0.8, 0.8]],
    drive: 0.005,
  },
  soundSystem: {
    name: 'Tuned club rig, horn-loaded subs',
    hp: [26, 0.7], lp: [18000, 0.7],
    bands: [[42, 1.0, 5.5], [95, 1.1, 2.0], [330, 1.1, -2.4], [2600, 0.9, 1.6], [10000, 0.7, 1.4, 'highshelf']],
    drive: 0.10,
  },
  lineArray: {
    name: 'Flown line array, system-tuned',
    hp: [30, 0.75], lp: [18000, 0.7],
    bands: [[45, 1.0, 3.4], [280, 1.1, -2.2], [2400, 0.9, 1.6]],
    drive: 0.05,
  },
  carDoors: {
    name: 'Properly tuned car system',
    hp: [40, 0.8], lp: [19000, 0.7],
    bands: [[60, 1.0, 3.0], [300, 1.2, -2.6], [900, 1.4, -1.5], [5000, 0.9, 1.2]],
    drive: 0.03,
  },
};

export const VENUES = [
  {
    id: 'studio',
    name: 'Control Room',
    place: 'Treated control room',
    note: 'The reference. Almost no room — this is roughly what the mix engineer heard.',
    system: 'monitors',
    dims: [6.5, 4.8, 3.0],
    materials: { xMin: 'deepAbsorber', xMax: 'deepAbsorber', yMin: 'deepAbsorber', yMax: 'gypsum', floor: 'woodFloor', ceiling: 'deepAbsorber' },
    listener: [3.0, 2.4, 1.2],
    spot: 'In the sweet spot, 1.6 m back',
    speakers: [[4.5, 3.05, 1.25], [4.5, 1.75, 1.25]],
    spread: 1.0, irSeconds: 0.35, trimDb: 0,
  },
  {
    id: 'living',
    name: 'Living Room',
    place: 'Carpeted lounge, 7.5 × 5 m',
    note: 'Speakers placed properly, a rug, shelves one side and curtains the other. What a room like this does when someone has bothered.',
    system: 'bookshelf',
    dims: [7.5, 5.0, 2.7],
    materials: { xMin: 'softFurn', xMax: 'gypsum', yMin: 'shelvedWall', yMax: 'shelvedWall', floor: 'carpet', ceiling: 'gypsum' },
    listener: [2.9, 2.5, 1.15],
    spot: 'On the sofa, 3.2 m back',
    speakers: [[5.9, 3.7, 1.05], [5.9, 1.3, 1.05]],
    spread: 1.0, irSeconds: 0.6, trimDb: 0,
  },
  {
    id: 'jazz',
    name: 'Jazz Club',
    place: 'Brick basement, low ceiling',
    note: 'Bare brick and a low ceiling, with a small, properly rung PA barely two tables away.',
    system: 'clubPA',
    dims: [12, 9, 3.2],
    materials: { xMin: 'audience', xMax: 'brick', yMin: 'brick', yMax: 'woodPanel', floor: 'woodFloor', ceiling: 'deepAbsorber' },
    listener: [6.2, 4.5, 1.15],
    spot: 'Two tables back, 4.5 m from the stack',
    speakers: [[10.2, 6.3, 2.05], [10.2, 2.7, 2.05]],
    spread: 1.3, irSeconds: 0.6, trimDb: 0,
  },
  {
    id: 'hall',
    name: 'Concert Hall',
    place: 'Shoebox hall, 17 m to the ceiling',
    note: 'Plaster and wood, a full house, the long even decay these rooms are built for.',
    system: 'hallRig',
    dims: [45, 22, 17],
    materials: { xMin: 'hallPanel', xMax: 'woodPanel', yMin: 'hallPanel', yMax: 'hallPanel', floor: 'audience', ceiling: 'plaster' },
    listener: [23, 11, 1.35],
    spot: 'Mid-stalls, 18 m from the stage',
    speakers: [[41, 14.6, 3.2], [41, 7.4, 3.2]],
    spread: 1.1, irSeconds: 2.6, trimDb: 0,
  },
  {
    id: 'church',
    name: 'Stone Church',
    place: 'Stone nave, 15 m to the vault',
    note: 'Four seconds of tail that gets warmer as it falls, and a beam tight enough that the music stays defined inside it.',
    system: 'columnPA',
    dims: [30, 14, 15],
    materials: { xMin: 'woodPanel', xMax: 'stone', yMin: 'stainedGlass', yMax: 'plaster', floor: 'naveSeating', ceiling: 'plaster' },
    listener: [17, 7, 1.3],
    spot: 'Ten rows back, 10 m from the array',
    speakers: [[26.5, 9.6, 4.2], [26.5, 4.4, 4.2]],
    // A steered array is far more directional than a plain column, which is
    // exactly what buys the clarity in a room this live.
    spread: 2.2, irSeconds: 4.9, trimDb: 0,
  },
  {
    id: 'club',
    name: 'Nightclub',
    place: 'Concrete room, treated ceiling',
    note: 'Horn-loaded subs, a treated ceiling, a floor full of people. Tight enough that the kick lands, still big enough to feel.',
    system: 'soundSystem',
    dims: [24, 16, 5.5],
    materials: { xMin: 'audience', xMax: 'concrete', yMin: 'concrete', yMax: 'brick', floor: 'clubFloor', ceiling: 'clubCeiling' },
    listener: [13, 8, 1.6],
    spot: 'Out on the floor, 9 m from the stacks',
    speakers: [[21.5, 11.6, 2.6], [21.5, 4.4, 2.6]],
    spread: 1.6, irSeconds: 1.2, trimDb: 0,
    cardioidSubs: true,
  },
  {
    id: 'stadium',
    name: 'Stadium',
    place: 'Open bowl, 190 × 140 m',
    note: 'Sixty-seven metres of air between you and the arrays, with the top end pushed back up to survive the trip.',
    system: 'lineArray',
    dims: [190, 140, 38],
    materials: { xMin: 'audience', xMax: 'audience', yMin: 'audience', yMax: 'audience', floor: 'grass', ceiling: 'openSky' },
    listener: [95, 70, 2],
    spot: 'Middle of the bowl, 67 m from the arrays',
    speakers: [[150, 100, 27], [150, 40, 27]],
    spread: 2.1, irSeconds: 2.7, trimDb: 0,
    airComp: true,
    cardioidSubs: true,
  },
  {
    id: 'field',
    name: 'Open Air Field',
    place: 'Festival ground, no walls',
    note: 'Nothing to reflect off but the grass. Just distance, air, and a rig tuned to punch through both.',
    system: 'lineArray',
    dims: [300, 300, 120],
    materials: { xMin: 'openSky', xMax: 'openSky', yMin: 'openSky', yMax: 'openSky', floor: 'grass', ceiling: 'openSky' },
    listener: [160, 150, 1.65],
    spot: 'In the crowd, 74 m from the stage',
    speakers: [[232, 166, 8.5], [232, 134, 8.5]],
    spread: 2.1, irSeconds: 0.8, trimDb: 0,
    airComp: true,
    cardioidSubs: true,
    // No walls means no reverberant field. What little decay there is comes off
    // the crowd and the distant site structures, so it is stated rather than
    // derived — Eyring has nothing to work with out here.
    diffuse: 1,
    rt60Override: [0.55, 0.50, 0.44, 0.38, 0.30, 0.22, 0.16],
    diffuseRefDb: -21,
  },
  {
    id: 'car',
    name: 'Car',
    place: 'Saloon cabin',
    note: 'Door speakers a foot from one ear and three from the other, time-aligned as far as anyone can in a car. Nothing is centred.',
    system: 'carDoors',
    dims: [2.4, 1.6, 1.15],
    materials: { xMin: 'carTrim', xMax: 'glass', yMin: 'glass', yMax: 'glass', floor: 'carpet', ceiling: 'carTrim' },
    listener: [0.85, 0.48, 0.82],
    spot: "Driver's seat — nothing is centred",
    speakers: [[1.62, 1.46, 0.32], [1.62, 0.14, 0.32]],
    spread: 1.1, irSeconds: 0.25, trimDb: 0,
  },
];

export const venueById = (id) => VENUES.find((v) => v.id === id) || VENUES[1];
