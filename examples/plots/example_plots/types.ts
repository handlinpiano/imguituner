import { RegionMetadata } from '@/app/wasm/audio_processor_wrapper';

export interface BasePlotProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
  thresholdPercentage: number;
  onThresholdChange: (threshold: number) => void;
  zenMode: boolean;
  noteFrequency: number;
  showLines: boolean;
  onPreviousNote: () => void;
  onNextNote: () => void;
  onPrevOctave: () => void;
  onNextOctave: () => void;
  onToggleLines?: () => void;
}
