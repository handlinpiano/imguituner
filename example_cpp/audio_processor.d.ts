export interface AudioProcessorModule {
  AudioProcessor: new () => AudioProcessor;
  VectorFloat: new () => VectorFloat;
}

export interface AudioProcessor {
  delete(): void;
  processAudioDirect(inputPtr: number, outputPtr: number, size: number, sampleRate: number): void;
  setFreqOverlapFactor(factor: number): void;
  // Zoom configuration (new engine)
  setZoomDecimation(decimation: number): void;
  setZoomFftSize(fftSize: number): void;
  setZoomNumBins(numBins: number): void;
  setZoomWindowType(windowType: number): void; // 0=Hann, 1=Rectangular (temporary)
  setRegionFrequency(regionIndex: number, frequency: number, isDisplayRegion?: boolean): void;
  getRegionEnvelopeMax(regionIndex: number): number;
  getRegionEnvelopeMin(regionIndex: number): number;
  resetRegionEnvelopeMax(regionIndex: number): void;
  resetRegionEnvelopeMin(regionIndex: number): void;
  setRegionEnvelopeMax(regionIndex: number, value: number): void;
  setRegionEnvelopeMin(regionIndex: number, value: number): void;
  getRegionData(regionIndex: number): VectorFloat;
  getRegionBinCount(regionIndex: number): number;
  getRegionFrequencyPerBin(regionIndex: number): number;
  getRegionStartFrequency(regionIndex: number): number;
  getRegionEndFrequency(regionIndex: number): number;
  getRegionHighestMagnitude(regionIndex: number): number;
  setHarmonicCapturePartialNumber(partialNumber: number): void;
}

export interface VectorFloat {
  push_back(value: number): void;
  get(index: number): number;
  size(): number;
  delete(): void;
}

declare function createModule(options: { wasmBinary: ArrayBuffer }): Promise<AudioProcessorModule>;
export default createModule;
