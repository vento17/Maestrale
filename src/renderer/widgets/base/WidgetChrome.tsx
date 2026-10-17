import React from 'react';
import type { WidgetStyle } from '../../../shared/types/project';

// The box every widget sits in, in Design and in Live alike: background,
// radius, the optional Frame, a thin edge a few px wide, and — when showTitle
// is on — a title bar that grows out of the top edge with the widget's label.
// The content is inset by the edge so nothing hides under it.

export const EDGE_SIZE_DEFAULT = 2;
export const EDGE_COLOR_DEFAULT = '#3a3a3a';
export const TITLE_FONT_DEFAULT = 12;

export function chromeMetrics(s: WidgetStyle): { edge: number; titleH: number; edgeColor: string; titleFont: number } {
  const edge = Math.max(0, s.edgeSize ?? EDGE_SIZE_DEFAULT);
  const titleFont = Math.max(6, s.titleFontSize ?? TITLE_FONT_DEFAULT);
  const titleH = s.showTitle ? Math.round(titleFont * 1.5) + edge : edge;
  return { edge, titleH, edgeColor: s.edgeColor ?? EDGE_COLOR_DEFAULT, titleFont };
}

export default function WidgetChrome({ style: s, label, children, outerStyle, ...rest }: {
  style: WidgetStyle;
  label: string;
  children: React.ReactNode;
  outerStyle?: React.CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style'>): React.JSX.Element {
  const frame      = s.frame ?? 'none';
  const frameColor = s.frameColor ?? '#ffffff';
  const frameSize  = s.frameSize  ?? 1;
  const { edge, titleH, edgeColor, titleFont } = chromeMetrics(s);

  return (
    <div
      {...rest}
      style={{
        width: '100%', height: '100%',
        borderRadius: s.borderRadius,
        overflow: 'hidden',
        background: s.backgroundColor,
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: frame === 'outline' ? `inset 0 0 0 ${frameSize}px ${frameColor}` : undefined,
        border: edge > 0 ? `${edge}px solid ${edgeColor}` : undefined,
        borderTopWidth: titleH,
        ...outerStyle,
      }}
    >
      {s.showTitle && (
        <div style={{
          position: 'absolute', left: -edge, right: -edge, top: -titleH, height: titleH - edge,
          display: 'flex', alignItems: 'center', padding: `0 ${Math.max(4, edge + 4)}px`,
          fontSize: titleFont, lineHeight: 1, fontWeight: 600, color: s.labelColor,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          {label}
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0 }}>
        {children}
      </div>
      {frame === 'underline' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: frameSize, background: frameColor, pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
