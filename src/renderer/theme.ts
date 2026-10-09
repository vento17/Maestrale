import { pal, onPalette } from './palette';
// LiveForge palette: black / greys / white + laguna (desaturated sea green,
// leaning blue) + fire orange. Red only where it means "recording" or a clock.
const make_AQUA = () => (pal('#4fb3b8'));
export let AQUA = make_AQUA();
onPalette(() => { AQUA = make_AQUA(); });
const make_AQUA_BRIGHT = () => (pal('#8fd3d6'));
export let AQUA_BRIGHT = make_AQUA_BRIGHT();
onPalette(() => { AQUA_BRIGHT = make_AQUA_BRIGHT(); });
const make_AQUA_DIM = () => (pal('#2a6366'));
export let AQUA_DIM = make_AQUA_DIM();
onPalette(() => { AQUA_DIM = make_AQUA_DIM(); });
const make_ORANGE = () => (pal('#ff8a1f'));
export let ORANGE = make_ORANGE();
onPalette(() => { ORANGE = make_ORANGE(); });
const make_ORANGE_BRIGHT = () => (pal('#ffb36b'));
export let ORANGE_BRIGHT = make_ORANGE_BRIGHT();
onPalette(() => { ORANGE_BRIGHT = make_ORANGE_BRIGHT(); });
const make_ORANGE_DIM = () => (pal('#8a4a12'));
export let ORANGE_DIM = make_ORANGE_DIM();
onPalette(() => { ORANGE_DIM = make_ORANGE_DIM(); });
export const REC_RED = '#e0322b';

// Several things to tell apart (dots, lanes…) without leaving the palette.
const make_MULTI = () => (['#ffffff', ORANGE, AQUA, ORANGE_BRIGHT, AQUA_BRIGHT, pal('#c96a10'), pal('#2f8a8f'), '#9a9a9a']);
export let MULTI = make_MULTI();
onPalette(() => { MULTI = make_MULTI(); });
