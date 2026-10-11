import DmxRecorderLive from '../../widgets/DmxRecorder/DmxRecorderLive';
import DmxPlayerLive from '../../widgets/DmxPlayer/DmxPlayerLive';
import type { DmxRecorderWidget, DmxPlayerWidget, ClockWidget, DmxMonitorWidget } from '../../../shared/types/project';
import ClockLive from '../../widgets/Clock/ClockLive';
import DmxMonitorLive from '../../widgets/DmxMonitor/DmxMonitorLive';
import React from 'react';
import type {
  Widget, CuesWidget, TimelineWidget, SpoutInputWidget, NdiInputWidget, SubmastersWidget,
  RouterWidget, AudioAnalyserWidget, SoundPlayerWidget, LfoWidget, MathWidget, ValueDisplayWidget,
  MasterLevelWidget, AudioLevelWidget, SketchWidget, InstanceWidget, ManualWidget, KeyboardWidget,
} from '../../../shared/types/project';
import SliderBankLive from '../../widgets/SliderBank/SliderBankLive';
import ButtonGridLive from '../../widgets/ButtonGrid/ButtonGridLive';
import KnobBankLive from '../../widgets/KnobBank/KnobBankLive';
import XYPadLive from '../../widgets/XYPad/XYPadLive';
import ImageWidgetLive from '../../widgets/ImageWidget/ImageWidgetLive';
import TextWidgetLive from '../../widgets/TextWidget/TextWidgetLive';
import StepSequencerLive from '../../widgets/StepSequencer/StepSequencerLive';
import GraphWidgetLive from '../../widgets/GraphWidget/GraphWidgetLive';
import CuesLive from '../../widgets/Cues/CuesLive';
import TimelineLive from '../../widgets/Timeline/TimelineLive';
import SpoutInputLive from '../../widgets/SpoutInput/SpoutInputLive';
import NdiInputLive from '../../widgets/NdiInput/NdiInputLive';
import SubmastersLive from '../../widgets/Submasters/SubmastersLive';
import RouterLive from '../../widgets/Router/RouterLive';
import AudioAnalyserLive from '../../widgets/AudioAnalyser/AudioAnalyserLive';
import SoundPlayerLive from '../../widgets/SoundPlayer/SoundPlayerLive';
import LfoWidgetLive from '../../widgets/LfoWidget/LfoWidgetLive';
import MathWidgetLive from '../../widgets/MathWidget/MathWidgetLive';
import ValueDisplayLive from '../../widgets/ValueDisplay/ValueDisplayLive';
import SketchLive from '../../widgets/Sketch/SketchLive';
import AudioLevelLive from '../../widgets/AudioLevel/AudioLevelLive';
import EncoderLive from '../../widgets/Encoder/EncoderLive';
import EtcLive from '../../widgets/Etc/EtcLive';
import MasterLevelLive from '../../widgets/MasterLevel/MasterLevelLive';
import InstanceLive from '../../widgets/Instance/InstanceLive';
import ManualLive from '../../widgets/Manual/ManualLive';
import KeyboardLive from '../../widgets/Keyboard/KeyboardLive';
import ShellLive from '../../widgets/Shell/ShellLive';
import PaletteLive from '../../widgets/Palette/PaletteLive';
import MergeLive from '../../widgets/Merge/MergeLive';

// The live rendering of a single widget's inner content (no positioning wrapper).
// Shared by LiveCanvas and by the Instance widget (which renders its source here).
export default function LiveWidgetInner({ widget }: { widget: Widget }): React.JSX.Element | null {
  switch (widget.kind) {
    case 'sliderBank':    return <SliderBankLive widget={widget} />;
    case 'buttonGrid':    return <ButtonGridLive widget={widget} />;
    case 'knobBank':      return <KnobBankLive widget={widget} />;
    case 'xyPad':         return <XYPadLive widget={widget} />;
    case 'imageWidget':   return <ImageWidgetLive widget={widget} />;
    case 'textWidget':    return <TextWidgetLive widget={widget} />;
    case 'stepSequencer': return <StepSequencerLive widget={widget} />;
    case 'graphWidget':   return <GraphWidgetLive widget={widget} />;
    case 'cues':          return <CuesLive widget={widget as CuesWidget} />;
    case 'timeline':      return <TimelineLive widget={widget as TimelineWidget} />;
    case 'spoutInput':    return <SpoutInputLive widget={widget as SpoutInputWidget} />;
    case 'ndiInput':      return <NdiInputLive widget={widget as NdiInputWidget} />;
    case 'submasters':    return <SubmastersLive widget={widget as SubmastersWidget} />;
    case 'router':        return <RouterLive widget={widget as RouterWidget} />;
    case 'audioAnalyser': return <AudioAnalyserLive widget={widget as AudioAnalyserWidget} />;
    case 'soundPlayer':   return <SoundPlayerLive widget={widget as SoundPlayerWidget} />;
    case 'noiseWidget':
    case 'lfoWidget':     return <LfoWidgetLive widget={widget as LfoWidget} />;
    case 'mathWidget':    return <MathWidgetLive widget={widget as MathWidget} />;
    case 'valueDisplay':  return <ValueDisplayLive widget={widget as ValueDisplayWidget} />;
    case 'masterLevel':   return <MasterLevelLive widget={widget as MasterLevelWidget} />;
    case 'sketch':        return <SketchLive widget={widget as SketchWidget} />;
    case 'audioLevel':    return <AudioLevelLive widget={widget as AudioLevelWidget} />;
    case 'etc':           return <EtcLive widget={widget as import('../../../shared/types/project').EtcWidget} />;
    case 'encoder':       return <EncoderLive widget={widget as import('../../../shared/types/project').EncoderWidget} />;
    case 'instance':      return <InstanceLive widget={widget as InstanceWidget} />;
    case 'keyboard':      return <KeyboardLive widget={widget as KeyboardWidget} />;
    case 'manual':        return <ManualLive widget={widget as ManualWidget} />;
    case 'dmxRecorder':   return <DmxRecorderLive widget={widget as DmxRecorderWidget} />;
    case 'dmxPlayer':     return <DmxPlayerLive widget={widget as DmxPlayerWidget} />;
    case 'clock':         return <ClockLive widget={widget as ClockWidget} />;
    case 'dmxMonitor':    return <DmxMonitorLive widget={widget as DmxMonitorWidget} />;
    case 'shell':         return <ShellLive widget={widget} />;
    case 'palette':       return <PaletteLive widget={widget} />;
    case 'merge':         return <MergeLive widget={widget} />;
    default:              return null;
  }
}
