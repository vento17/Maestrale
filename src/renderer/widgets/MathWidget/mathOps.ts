import type { MathOperation } from '../../../shared/types/project';

// One operation over any number of inputs. Inputs that have nothing on them are
// not passed in at all, so a lone cable comes out unchanged (add 1 = itself,
// avg 1 = itself). subtract: the first minus all the others. invert / abs: the
// first input only.
export function applyOpN(inputs: number[], op: MathOperation): number {
  if (inputs.length === 0) return 0;
  const [first, ...rest] = inputs;
  switch (op) {
    case 'add':      return inputs.reduce((s, v) => s + v, 0);
    case 'subtract': return rest.reduce((s, v) => s - v, first);
    case 'multiply': return inputs.reduce((p, v) => p * v, 1);
    case 'min':      return Math.min(...inputs);
    case 'max':      return Math.max(...inputs);
    case 'avg':      return inputs.reduce((s, v) => s + v, 0) / inputs.length;
    case 'invert':   return 1 - first;
    case 'abs':      return Math.abs(first);
  }
}

export function opSymbol(op: string): string {
  switch (op) {
    case 'add':      return '+';
    case 'subtract': return '−';
    case 'multiply': return '×';
    case 'min':      return 'min';
    case 'max':      return 'max';
    case 'avg':      return 'avg';
    case 'invert':   return '1−x';
    case 'abs':      return '|x|';
    default:         return '?';
  }
}

/** Operations that only look at the first input. */
export function isUnaryOp(op: string): boolean {
  return op === 'invert' || op === 'abs';
}
