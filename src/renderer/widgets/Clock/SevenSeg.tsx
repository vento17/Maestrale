import React from 'react';

// Seven-segment digits: three horizontal bars (a, g, d) and four vertical ones
// (f, b, e, c), like a stage clock. Unlit segments stay faintly visible.
//
//    aaa
//   f   b
//    ggg
//   e   c
//    ddd

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

// Digit cell 60 × 100, bars 10 thick, bevelled ends.
const W = 60, H = 100, T = 10;
function hBar(y: number): string {
  return `${T * 0.6},${y} ${T},${y - T / 2} ${W - T},${y - T / 2} ${W - T * 0.6},${y} ${W - T},${y + T / 2} ${T},${y + T / 2}`;
}
function vBar(x: number, y0: number, y1: number): string {
  return `${x},${y0 + T * 0.6} ${x + T / 2},${y0 + T} ${x + T / 2},${y1 - T} ${x},${y1 - T * 0.6} ${x - T / 2},${y1 - T} ${x - T / 2},${y0 + T}`;
}
const SHAPES: Record<string, string> = {
  a: hBar(T / 2), g: hBar(H / 2), d: hBar(H - T / 2),
  f: vBar(T / 2, 0, H / 2), b: vBar(W - T / 2, 0, H / 2),
  e: vBar(T / 2, H / 2, H), c: vBar(W - T / 2, H / 2, H),
};

function Digit({ ch, x, color, dim }: { ch: string; x: number; color: string; dim: string }): React.JSX.Element {
  const on = SEGMENTS[ch] ?? '';
  return (
    <g transform={`translate(${x},0)`}>
      {Object.entries(SHAPES).map(([k, pts]) => (
        <polygon key={k} points={pts} fill={on.includes(k) ? color : dim} />
      ))}
    </g>
  );
}

// "12:34:56" → digits and blinking-free colons, scaled to fit its box.
export default function SevenSeg({ text, color, colonOn = true }: { text: string; color: string; colonOn?: boolean }): React.JSX.Element {
  const dim = `${color}1a`;
  const GAP = 12, COLON = 26;
  let x = 0;
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ':') {
      const cx = x + COLON / 2;
      parts.push(
        <g key={i}>
          <rect x={cx - T / 2} y={H * 0.3 - T / 2} width={T} height={T} fill={colonOn ? color : dim} />
          <rect x={cx - T / 2} y={H * 0.7 - T / 2} width={T} height={T} fill={colonOn ? color : dim} />
        </g>,
      );
      x += COLON;
    } else {
      parts.push(<Digit key={i} ch={ch} x={x} color={color} dim={dim} />);
      x += W + GAP;
    }
  }
  const width = Math.max(1, x - GAP);
  return (
    <svg viewBox={`-4 -4 ${width + 8} ${H + 8}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {parts}
    </svg>
  );
}
