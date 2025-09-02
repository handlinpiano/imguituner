// Vector type from C++
export interface VectorFloat {
  size(): number;
  get(index: number): number;
  push_back(value: number): void;
  delete(): void;
}

// Strike Detection Types
export type StrikeState = 'WAITING' | 'ATTACK' | 'MONITORING';
export type RegionArray = [number, number, number, number, number, number, number, number]; // Array for region data with MAX_REGIONS (8) elements

// Legacy HarmonicMeasurement and HarmonicsArray removed - now using HarmonicStatistics

// NEW: Statistical results from window-based harmonic analysis
export interface HarmonicStatistics {
  ratio_mean: number; // Mean ratio across samples (actually harmonic ratios, not frequency!)
  ratio_std: number; // Standard deviation of ratio
  magnitude_mean: number; // Mean magnitude across samples (psychoacoustically scaled)
  magnitude_median: number; // Median magnitude across samples (psychoacoustically scaled) - more robust for outlier rejection
  magnitude_std: number; // Standard deviation of magnitude
  confidence_mean: number; // Mean confidence across samples
  sample_count: number; // Number of valid samples
  outlier_rate: number; // Fraction of rejected outliers
  is_valid: boolean; // Whether statistics are valid
}

export type HarmonicStatisticsArray = [
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
  HarmonicStatistics,
]; // 8 harmonics (1-8)

export interface StrikeMeasurement {
  timestamp: number;
  frequency: number;
  magnitude: number;
  confidence: number;
  isValid: boolean;
  aboveThreshold: boolean;
  inWindow: boolean;

  // Re-engineered: Ratio-based harmonic measurements (H1-H8)
  // Each harmonic contains inharmonicity ratios relative to fundamental from same moment
  harmonicStatistics: HarmonicStatisticsArray; // Statistical analysis of harmonics 1-8
  windowSampleCount: number; // Number of samples collected in window
  windowDuration: number; // Actual duration of measurement window (ms)
  hasWindowData: boolean; // Whether window-based data is available
  displayRegionHarmonicIndex: number; // Which harmonic (0-7 for H1-H8) was the display region
}

// Region metadata for batch retrieval - PERFORMANCE OPTIMIZATION
export interface RegionMetadata {
  // Frequency analysis properties
  binCount: number; // Number of frequency bins in the analysis
  frequencyPerBin: number; // Hz per frequency bin
  startFrequency: number; // Lower bound of analyzed frequency range (Hz)
  endFrequency: number; // Upper bound of analyzed frequency range (Hz)

  // Amplitude measurements
  envelopeMax: number; // Maximum amplitude envelope value (proven 0.5/0.25 reduction system)
  envelopeMin: number; // Minimum amplitude envelope value
  highestMagnitude: number; // Highest magnitude found in region

  // Peak detection data
  peakFrequency: number; // Detected peak frequency with sub-bin accuracy
  peakMagnitude: number; // Magnitude at the detected peak
  peakBin: number; // Bin index of the detected peak
  peakConfidence: number; // Confidence metric for the peak detection (0-1)
}

// Direct memory access for zero-copy region data - PERFORMANCE OPTIMIZATION
export interface RegionDataView {
  dataPtr: number; // Memory address of float array in WASM memory
  length: number; // Number of elements
  startBin: number; // Starting bin index
  endBin: number; // Ending bin index
}

// Audio processor class interface
export interface AudioProcessor {
  delete(): void;
  setFreqOverlapFactor(factor: number): void;
  setRegionFrequency(regionIndex: number, frequency: number, isDisplayRegion?: boolean): void;
  getRegionEnvelopeMax(regionIndex: number): number;
  getRegionEnvelopeMin(regionIndex: number): number;
  resetRegionEnvelopeMax(regionIndex: number): void;
  resetRegionEnvelopeMin(regionIndex: number): void;
  setRegionEnvelopeMax(regionIndex: number, value: number): void;
  setRegionEnvelopeMin(regionIndex: number, value: number): void;
  processAudioDirect(inputPtr: number, outputPtr: number, size: number, sampleRate: number): void;
  getRegionData(regionIndex: number): Float32Array;
  getRegionBinCount(regionIndex: number): number;
  getRegionFrequencyPerBin(regionIndex: number): number;
  getRegionStartFrequency(regionIndex: number): number;
  getRegionEndFrequency(regionIndex: number): number;
  getRegionHighestMagnitude(regionIndex: number): number;
  getRegionPeakFrequency(regionIndex: number): number;
  getRegionPeakMagnitude(regionIndex: number): number;
  getRegionPeakConfidence(regionIndex: number): number;
  getRegionPeakBin(regionIndex: number): number;

  // PERFORMANCE OPTIMIZATION: Batch metadata retrieval
  getRegionMetadata(regionIndex: number): RegionMetadata;

  // PERFORMANCE OPTIMIZATION: Direct memory access to region data
  getRegionDataView(regionIndex: number): RegionDataView;

  // Strike detection state and measurement
  getStrikeState(): StrikeState;
  isInMeasurementWindow(): boolean;
  getStrikeMeasurement(): StrikeMeasurement;
  clearStrikeMeasurement(): void;
  resetStrikeDetection(): void;

  // Set which partial we're listening to (1=fundamental, 2=2nd partial, etc.)
  setHarmonicCapturePartialNumber(partialNumber: number): void;

  // Harmonic capture callback registration
  setHarmonicCaptureCallback(callback: any): void;

  // Harmonic capture global enable/disable (for battery optimization)
  setHarmonicCaptureEnabled(enabled: boolean): void;

  // Direct measurement access
  getStrikeMeasurementFrequency(): number;
  getStrikeMeasurementMagnitude(): number;
  getStrikeMeasurementConfidence(): number;
  getStrikeMeasurementTimestamp(): number;
  getStrikeMeasurementIsValid(): boolean;
  getCurrentMagnitudeThreshold(): number;

  // Strike detection configuration
  setStrikeDetectionTrigger(minMagnitude: number): void;
  setRequiredDecayingClusters(clusters: number): void;
  // Note: Frequency stability methods removed - strike detection now uses magnitude-only trigger

  // Strike detection configuration getters
  getStrikeDetectionTrigger(): number;
  getRequiredDecayingClusters(): number;
  // Note: Frequency stability getters removed

  // Manual halve button as user escape hatch
  halveRegionDisplayEnvelope(regionIndex: number): void;

  // Basic SIMD detection - keep this as it's useful information
  isSIMDEnabled(): boolean;
}

// Combined module interface
export interface AudioProcessorModule {
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  AudioProcessor: {
    new (): AudioProcessor;
  };
  VectorFloat: {
    new (): VectorFloat;
  };
}

// Add tuning visualization types
export interface TuningVisualizationPoint {
  x: number;
  y: number;
}

export interface TuningVisualizationData {
  points: TuningVisualizationPoint[];
  metadata: {
    noteFrequency: number;
    sampleRate: number;
    maxMagnitude: number;
  };
}
