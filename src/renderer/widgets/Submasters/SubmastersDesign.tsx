import { pal, palRgb } from '../../palette';
import React from 'react';
import type { SubmastersWidget } from '../../../shared/types/project';

export default function SubmastersDesign({ widget }: { widget: SubmastersWidget }): React.JSX.Element {
  const { countX, spacingX, spacingY, style, scenes } = widget;
  const REC_COL_W = 44;
  const pad = Math.max(spacingX, spacingY);

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      gap: spacingX,
      padding: pad,
      boxSizing: 'border-box',
    }}>
      {/* Scene columns */}
      <div style={{ flex: 1, display: 'flex', gap: spacingX, minWidth: 0 }}>
        {Array.from({ length: countX }, (_, i) => {
          const scene = scenes[i];
          const hasData = scene && Object.keys(scene.snapshot).length > 0;
          const btnColor = scene?.color ?? style.foregroundColor;

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: spacingY, minWidth: 0 }}>
              {/* Top button */}
              <div style={{
                flexShrink: 0, height: 24,
                background: hasData ? btnColor : 'rgba(255,255,255,0.08)',
                borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {style.showLabel && (
                  <span style={{ fontSize: Math.max(style.fontSize - 3, 7), color: style.labelColor, opacity: 0.8 }}>
                    {scene?.label ?? `${i + 1}`}
                  </span>
                )}
              </div>

              {/* Fader */}
              <div style={{
                flex: 1, position: 'relative',
                background: 'rgba(0,0,0,0.35)',
                borderRadius: 4, overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: '0%',
                  background: btnColor, opacity: 0.4,
                }} />
                <div style={{
                  position: 'absolute',
                  bottom: 'calc(0% - 6px)', left: '10%', right: '10%', height: 12,
                  background: btnColor, borderRadius: 3,
                }} />
              </div>

              {/* Bottom button */}
              <div style={{
                flexShrink: 0, height: 24,
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 3,
              }} />
            </div>
          );
        })}
      </div>

      {/* Right REC/DEL column */}
      <div style={{
        flexShrink: 0, width: REC_COL_W,
        display: 'flex', flexDirection: 'column', gap: spacingY,
      }}>
        <div style={{
          flex: 1, background: `rgba(${palRgb('#c86d1e')},0.25)`,
          borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${pal('#402915')}`,
        }}>
          <span style={{ fontSize: 9, color: pal('#d97a26'), fontWeight: 700, letterSpacing: 1 }}>REC</span>
        </div>
        <div style={{
          flex: 1, background: 'rgba(255,255,255,0.05)',
          borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid #252525',
        }}>
          <span style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 1 }}>DEL</span>
        </div>
      </div>
    </div>
  );
}
