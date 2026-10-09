import DmxRecorderDesign from '../DmxRecorder/DmxRecorderDesign';
import DmxPlayerDesign from '../DmxPlayer/DmxPlayerDesign';
import type { DmxRecorderWidget, DmxPlayerWidget, ClockWidget, DmxMonitorWidget } from '../../../shared/types/project';
import ClockDesign from '../Clock/ClockDesign';
import DmxMonitorDesign from '../DmxMonitor/DmxMonitorDesign';
import React from 'react';
import type { Widget, CuesWidget, TimelineWidget, SpoutInputWidget, NdiInputWidget, SubmastersWidget, RouterWidget, AudioAnalyserWidget, SoundPlayerWidget, LfoWidget, MathWidget, ValueDisplayWidget, MasterLevelWidget, AudioLevelWidget, SketchWidget, InstanceWidget, ManualWidget, KeyboardWidget } from '../../../shared/types/project';
import SliderBankDesign from '../SliderBank/SliderBankDesign';
import SketchDesign from '../Sketch/SketchDesign';
import AudioLevelDesign from '../AudioLevel/AudioLevelDesign';
import MasterLevelDesign from '../MasterLevel/MasterLevelDesign';
import InstanceDesign from '../Instance/InstanceDesign';
import ManualDesign from '../Manual/ManualDesign';
import KeyboardDesign from '../Keyboard/KeyboardDesign';
import ButtonGridDesign from '../ButtonGrid/ButtonGridDesign';
import KnobBankDesign from '../KnobBank/KnobBankDesign';
import XYPadDesign from '../XYPad/XYPadDesign';
import ImageWidgetDesign from '../ImageWidget/ImageWidgetDesign';
import TextWidgetDesign from '../TextWidget/TextWidgetDesign';
import StepSequencerDesign from '../StepSequencer/StepSequencerDesign';
import GraphWidgetDesign from '../GraphWidget/GraphWidgetDesign';
import CuesDesign from '../Cues/CuesDesign';
import TimelineDesign from '../Timeline/TimelineDesign';
import SpoutInputDesign from '../SpoutInput/SpoutInputDesign';
import NdiInputDesign from '../NdiInput/NdiInputDesign';
import SubmastersDesign from '../Submasters/SubmastersDesign';
import RouterDesign from '../Router/RouterDesign';
import AudioAnalyserDesign from '../AudioAnalyser/AudioAnalyserDesign';
import SoundPlayerDesign from '../SoundPlayer/SoundPlayerDesign';
import LfoWidgetDesign from '../LfoWidget/LfoWidgetDesign';
import MathWidgetDesign from '../MathWidget/MathWidgetDesign';
import ValueDisplayDesign from '../ValueDisplay/ValueDisplayDesign';

export default function WidgetPreview({ widget }: { widget: Widget }): React.JSX.Element {
  const inner = (() => {
    switch (widget.kind) {
      case 'sliderBank':    return <SliderBankDesign widget={widget} />;
      case 'buttonGrid':    return <ButtonGridDesign widget={widget} />;
      case 'knobBank':      return <KnobBankDesign widget={widget} />;
      case 'xyPad':         return <XYPadDesign widget={widget} />;
      case 'imageWidget':   return <ImageWidgetDesign widget={widget} />;
      case 'textWidget':    return <TextWidgetDesign widget={widget} />;
      case 'stepSequencer': return <StepSequencerDesign widget={widget} />;
      case 'graphWidget':   return <GraphWidgetDesign widget={widget} />;
      case 'cues':          return <CuesDesign widget={widget as CuesWidget} />;
      case 'timeline':      return <TimelineDesign widget={widget as TimelineWidget} />;
      case 'spoutInput':    return <SpoutInputDesign widget={widget as SpoutInputWidget} />;
      case 'ndiInput':      return <NdiInputDesign widget={widget as NdiInputWidget} />;
      case 'submasters':    return <SubmastersDesign widget={widget as SubmastersWidget} />;
      case 'router':        return <RouterDesign widget={widget as RouterWidget} />;
      case 'audioAnalyser':    return <AudioAnalyserDesign widget={widget as AudioAnalyserWidget} />;
      case 'soundPlayer':      return <SoundPlayerDesign widget={widget as SoundPlayerWidget} />;
      case 'noiseWidget':
      case 'lfoWidget':        return <LfoWidgetDesign widget={widget as LfoWidget} />;
      case 'mathWidget':       return <MathWidgetDesign widget={widget as MathWidget} />;
      case 'valueDisplay':     return <ValueDisplayDesign widget={widget as ValueDisplayWidget} />;
      case 'masterLevel':      return <MasterLevelDesign widget={widget as MasterLevelWidget} />;
      case 'sketch':           return <SketchDesign widget={widget as SketchWidget} />;
      case 'audioLevel':       return <AudioLevelDesign widget={widget as AudioLevelWidget} />;
      case 'instance':         return <InstanceDesign widget={widget as InstanceWidget} />;
      case 'keyboard':         return <KeyboardDesign widget={widget as KeyboardWidget} />;
      case 'manual':           return <ManualDesign widget={widget as ManualWidget} />;
      case 'dmxRecorder':      return <DmxRecorderDesign widget={widget as DmxRecorderWidget} />;
      case 'dmxPlayer':        return <DmxPlayerDesign widget={widget as DmxPlayerWidget} />;
      case 'clock':            return <ClockDesign widget={widget as ClockWidget} />;
      case 'dmxMonitor':       return <DmxMonitorDesign widget={widget as DmxMonitorWidget} />;
      default:                 return null;
    }
  })();

  const s = widget.style;
  const frame      = s.frame ?? 'none';
  const frameColor = s.frameColor ?? '#ffffff';
  const frameSize  = s.frameSize  ?? 1;

  return (
    <div style={{
      width: '100%', height: '100%',
      borderRadius: s.borderRadius,
      overflow: 'hidden',
      background: s.backgroundColor,
      position: 'relative',
      boxSizing: 'border-box',
      boxShadow: frame === 'outline' ? `inset 0 0 0 ${frameSize}px ${frameColor}` : undefined,
    }}>
      {inner}
      {frame === 'underline' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: frameSize, background: frameColor, pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
