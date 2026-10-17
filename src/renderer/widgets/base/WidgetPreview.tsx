import DmxRecorderDesign from '../DmxRecorder/DmxRecorderDesign';
import DmxPlayerDesign from '../DmxPlayer/DmxPlayerDesign';
import type { DmxRecorderWidget, DmxPlayerWidget, ClockWidget, DmxMonitorWidget } from '../../../shared/types/project';
import ClockDesign from '../Clock/ClockDesign';
import DmxMonitorDesign from '../DmxMonitor/DmxMonitorDesign';
import React from 'react';
import WidgetChrome from './WidgetChrome';
import type { Widget, CuesWidget, TimelineWidget, SpoutInputWidget, NdiInputWidget, SubmastersWidget, RouterWidget, AudioAnalyserWidget, SoundPlayerWidget, LfoWidget, MathWidget, ValueDisplayWidget, MasterLevelWidget, AudioLevelWidget, SketchWidget, InstanceWidget, ManualWidget, KeyboardWidget } from '../../../shared/types/project';
import SliderBankDesign from '../SliderBank/SliderBankDesign';
import SketchDesign from '../Sketch/SketchDesign';
import AudioLevelDesign from '../AudioLevel/AudioLevelDesign';
import IControlsLive from '../IControls/IControlsLive';
import EncoderDesign from '../Encoder/EncoderDesign';
import EtcLive from '../Etc/EtcLive';
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
import ShellLive from '../Shell/ShellLive';
import PaletteLive from '../Palette/PaletteLive';
import MergeLive from '../Merge/MergeLive';

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
      case 'iControls':        return <IControlsLive preview widget={widget} />;
      case 'etc':              return <EtcLive preview widget={widget as import('../../../shared/types/project').EtcWidget} />;
      case 'encoder':          return <EncoderDesign widget={widget as import('../../../shared/types/project').EncoderWidget} />;
      case 'instance':         return <InstanceDesign widget={widget as InstanceWidget} />;
      case 'keyboard':         return <KeyboardDesign widget={widget as KeyboardWidget} />;
      case 'manual':           return <ManualDesign widget={widget as ManualWidget} />;
      case 'dmxRecorder':      return <DmxRecorderDesign widget={widget as DmxRecorderWidget} />;
      case 'dmxPlayer':        return <DmxPlayerDesign widget={widget as DmxPlayerWidget} />;
      case 'clock':            return <ClockDesign widget={widget as ClockWidget} />;
      case 'dmxMonitor':       return <DmxMonitorDesign widget={widget as DmxMonitorWidget} />;
      case 'shell':            return <ShellLive preview widget={widget} />;
      case 'palette':          return <PaletteLive preview widget={widget} />;
      case 'merge':            return <MergeLive preview widget={widget} />;
      default:                 return null;
    }
  })();

  return <WidgetChrome style={widget.style} label={widget.label}>{inner}</WidgetChrome>;
}
