import createModule from './audio_processor';
import type {
  AudioProcessor,
  AudioProcessorModule,
  RegionMetadata,
  RegionDataView,
  StrikeMeasurement,
} from './types';

// Re-export types for convenience
export type {
  RegionMetadata,
  HarmonicStatistics,
  HarmonicStatisticsArray,
  StrikeMeasurement,
} from './types';

// Module state
let audioProcessorModule: AudioProcessorModule | null = null;
let audioProcessor: AudioProcessor | null = null;
let isInitializing = false;
let initError: Error | null = null;
let simdSupported: boolean = false;
let staticInputPtr: number | null = null;
let currentAllocatedSize: number = 0;
const ALIGNMENT = 32;

export const WASM_VERSION = '1.0.0';

// Store pending values
interface PendingValues {
  freqOverlapFactor: number | null;
  regions: Array<{
    frequency: number | null;
    isDisplayRegion: boolean;
  }>;
}

// Move magic numbers to named constants
const INITIAL_MEMORY_SIZE = 64 * 1024 * 1024; // 64MB
const INITIAL_REGIONS_COUNT = 8;

let pendingValues: PendingValues = {
  freqOverlapFactor: null,
  regions: Array.from({ length: INITIAL_REGIONS_COUNT }, () => ({
    frequency: null,
    isDisplayRegion: true,
  })),
};

// Add state getters
export const getInitializationState = () => ({
  isInitializing,
  hasError: !!initError,
  error: initError,
  isReady: !!audioProcessor,
  simdSupported,
});

async function _checkWasmSimdSupport(): Promise<boolean> {
  try {
    // Test for WASM SIMD support using a more reliable method
    const simdTestBinary = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d, // magic bytes
      0x01,
      0x00,
      0x00,
      0x00, // version: 1
      0x01,
      0x05, // type section
      0x01, // number of types
      0x60,
      0x00,
      0x01,
      0x7b, // function type: () -> v128
      0x03,
      0x02, // function section
      0x01,
      0x00, // 1 function, type 0
      0x0a,
      0x0a, // code section
      0x01, // 1 function
      0x08, // function body size
      0x00, // local declarations
      0xfd,
      0x0f, // i8x16.splat
      0x00, // value 0
      0x0b, // end
    ]);

    const result = await WebAssembly.validate(simdTestBinary);
    simdSupported = result;

    // Fallback detection for modern browsers if the test fails
    if (!result) {
      // Chrome-specific detection based on browser version
      const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch && parseInt(chromeMatch[1], 10) >= 91) {
        simdSupported = true;
        return true;
      }

      // Firefox-specific detection
      const firefoxMatch = navigator.userAgent.match(/Firefox\/(\d+)/);
      if (firefoxMatch && parseInt(firefoxMatch[1], 10) >= 89) {
        simdSupported = true;
        return true;
      }

      // Safari-specific detection
      const safariMatch =
        navigator.userAgent.match(/Safari\/(\d+)/) && !navigator.userAgent.includes('Chrome');
      const versionMatch = navigator.userAgent.match(/Version\/(\d+)/);
      if (safariMatch && versionMatch && parseInt(versionMatch[1], 10) >= 16.4) {
        simdSupported = true;
        return true;
      }
    }

    return simdSupported;
  } catch (error) {
    console.warn('Error checking SIMD support:', error);

    // Try fallback detection if the test throws an error
    try {
      // Chrome-specific detection based on browser version
      const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch && parseInt(chromeMatch[1], 10) >= 91) {
        simdSupported = true;
        return true;
      }
    } catch (fallbackError) {
      console.warn('Fallback detection failed:', fallbackError);
    }

    simdSupported = false;
    return false;
  }
}

export async function initializeAudioProcessor(wasmBinary: ArrayBuffer): Promise<void> {
  if (isInitializing) {
    return;
  }

  try {
    isInitializing = true;
    initError = null;

    // Check SIMD support before initializing
    const simdSupported = await _checkWasmSimdSupport();

    // Create module with explicit SIMD configuration
    // Toggle WASM stdio printing (printf) via localStorage key
    // Set localStorage.setItem('piano-tuner-wasm-debug','1') to enable; remove/0 to disable
    const wasmDebugEnabled =
      typeof window !== 'undefined' && localStorage.getItem('piano-tuner-wasm-debug') === '1';

    const moduleConfig = {
      wasmBinary,
      simd: simdSupported,
      initialMemory: INITIAL_MEMORY_SIZE,
      wasmFeatures: simdSupported ? ['simd'] : [],
      print: wasmDebugEnabled ? (text: string) => console.log(text) : (_: string) => {},
      printErr: wasmDebugEnabled ? (text: string) => console.error(text) : (_: string) => {},
      noInitialRun: true,
      noExitRuntime: true,
    };

    try {
      audioProcessorModule = (await createModule(moduleConfig)) as unknown as AudioProcessorModule;
    } catch (moduleError) {
      console.error('Error creating WebAssembly module:', moduleError);
      throw new Error(`Failed to create WebAssembly module: ${moduleError}`);
    }

    if (!audioProcessorModule) {
      throw new Error('Failed to create audio processor module');
    }

    try {
      audioProcessor = new audioProcessorModule.AudioProcessor();
    } catch (error) {
      console.error('Error creating AudioProcessor instance:', error);
      const moduleAny = audioProcessorModule as any;

      if (typeof moduleAny._AudioProcessor === 'function') {
        try {
          audioProcessor = new moduleAny._AudioProcessor();
        } catch (fallbackError) {
          console.error('Fallback initialization failed:', fallbackError);
          throw new Error(`Failed to initialize AudioProcessor: ${error}`);
        }
      } else {
        throw new Error(`Failed to initialize AudioProcessor: ${error}`);
      }
    }

    // Apply any pending values
    updateAudioProcessor();

    // Apply pending region settings
    pendingValues.regions.forEach((region, index) => {
      if (region.frequency !== null) {
        audioProcessor!.setRegionFrequency(index, region.frequency, region.isDisplayRegion);
      }
    });

    // Apply pending harmonic capture callback
    if (_pendingHarmonicCaptureCallback) {
      audioProcessor!.setHarmonicCaptureCallback(_pendingHarmonicCaptureCallback);
      _pendingHarmonicCaptureCallback = null; // Clear after applying
    }

    // Install strike start dispatcher if supported so all registered listeners receive events
    const apAny = audioProcessor as any;
    if (typeof apAny.setStrikeStartCallback === 'function' && !_strikeStartDispatcherRegistered) {
      apAny.setStrikeStartCallback((evt: any) => {
        _strikeStartListeners.forEach(listener => {
          try {
            listener(evt);
          } catch (e) {
            console.warn('StrikeStart listener error:', e);
          }
        });
      });
      _strikeStartDispatcherRegistered = true;
    }

    // Restore envelope max values from localStorage to WASM after initialization
    for (let i = 0; i < INITIAL_REGIONS_COUNT; i++) {
      const preservedValue = loadEnvelopeMaxFromStorage(i);
      if (preservedValue !== null && preservedValue > 0) {
        audioProcessor!.setRegionEnvelopeMax(i, preservedValue);
        // Also restore to cache for immediate use
        limiter.setValue(`envelope_max_${i}`, preservedValue);
      }
    }
  } catch (error) {
    console.error('Failed to initialize audio processor:', error);
    initError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    isInitializing = false;
  }
}

export async function initAudioProcessor(): Promise<void> {
  if (typeof window === 'undefined') return;

  if (!audioProcessorModule && !isInitializing) {
    try {
      const wasmUrl = '/audio_processor.wasm';
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio_processor.wasm: ${response.statusText}`);
      }
      const wasmBinary = await response.arrayBuffer();

      await initializeAudioProcessor(wasmBinary);

      if (audioProcessor) {
        pendingValues.regions.forEach((region, index) => {
          if (region.frequency !== null) {
            audioProcessor!.setRegionFrequency(index, region.frequency, region.isDisplayRegion);
            region.frequency = null;
          }
        });
      }
    } catch (err) {
      console.error('Failed to initialize AudioProcessor:', err);
      throw err;
    }
  }
}

// Simplified frame rate limiter
class UpdateLimiter {
  private lastUpdateTimes: Map<string, number> = new Map();
  private cache: Map<string, any> = new Map();
  private throttleMs: number = 8; // Simple 8ms throttle (~120fps) works for all devices

  shouldUpdate(key: string): boolean {
    const now = performance.now();
    const lastTime = this.lastUpdateTimes.get(key) || 0;

    if (now - lastTime >= this.throttleMs) {
      this.lastUpdateTimes.set(key, now);
      return true;
    }
    return false;
  }

  getValue<T>(key: string): T | null {
    return this.cache.has(key) ? this.cache.get(key) : null;
  }

  setValue<T>(key: string, value: T): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
    this.lastUpdateTimes.clear();
  }
}

// Single limiter instance for the module
const limiter = new UpdateLimiter();

export function setFreqOverlapFactor(_value: number) {
  // Deprecated under Zoom engine; keep as no-op to avoid churn/lints
  if (!audioProcessor || !limiter.shouldUpdate('freq_overlap')) return;
  try {
    console.warn('[Deprecated] setFreqOverlapFactor is a no-op under Zoom engine');
  } catch {}
  pendingValues.freqOverlapFactor = null;
}

// PERFORMANCE OPTIMIZATION: Direct memory access to region data - NO ALLOCATIONS
export function getRegionData(regionIndex: number): Float32Array {
  if (!audioProcessor || !audioProcessorModule) return new Float32Array(0);

  const cacheKey = `region_data_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cachedValue = limiter.getValue<Float32Array>(cacheKey);
    if (cachedValue) return cachedValue;
  }

  try {
    // ZERO-COPY: Get direct view into WASM memory instead of vector allocation
    const view: RegionDataView = audioProcessor.getRegionDataView(regionIndex);

    if (!view.dataPtr || view.length <= 0) {
      const emptyResult = new Float32Array(0);
      limiter.setValue(cacheKey, emptyResult);
      return emptyResult;
    }

    // Create Float32Array view directly into WASM memory - NO COPY, NO ALLOCATION
    const directView = new Float32Array(
      audioProcessorModule.HEAPF32.buffer,
      view.dataPtr, // Memory address offset
      view.length // Length
    );

    limiter.setValue(cacheKey, directView);
    return directView;
  } catch (error) {
    console.error('Error getting region data:', error);
    return limiter.getValue<Float32Array>(cacheKey) || new Float32Array(0);
  }
}

// POC: compute zoom spectrum via Goertzel bank in WASM (decimated baseband)
// Removed: Zoom spectrum POC helpers (integrated into core engine)

// windowType: 0 = Hann, 1 = Rectangular
// Removed: Zoom spectrum POC helpers (integrated into core engine)

// Zoom configuration passthroughs
export function setZoomDecimation(decimation: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setZoomDecimation(decimation);
}
export function setZoomFftSize(fftSize: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setZoomFftSize(fftSize);
}
export function setZoomNumBins(numBins: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setZoomNumBins(numBins);
}
export function setZoomWindowType(windowType: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setZoomWindowType(windowType);
}

// Add a module-level counter for logging
const _regionMetadataLogCounter = 0;

export function getRegionMetadata(regionIndex: number): RegionMetadata | null {
  if (!audioProcessor) return null;

  const cacheKey = `region_metadata_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    return limiter.getValue<RegionMetadata>(cacheKey) || null;
  }

  try {
    // PERFORMANCE OPTIMIZATION: Single batch call instead of 10+ individual calls
    const metadata = audioProcessor.getRegionMetadata(regionIndex);

    // Validate values to ensure they're reasonable
    if (isNaN(metadata.envelopeMax) || metadata.envelopeMax <= 0) {
      metadata.envelopeMax = 1.0; // Default to a reasonable value
    }

    if (isNaN(metadata.envelopeMin) || metadata.envelopeMin < 0) {
      metadata.envelopeMin = 0;
    }

    // Ensure min is actually less than max
    if (metadata.envelopeMin >= metadata.envelopeMax) {
      metadata.envelopeMin = Math.max(0, metadata.envelopeMax * 0.1);
    }

    limiter.setValue(cacheKey, metadata);
    return metadata;
  } catch (error) {
    console.error(`Error getting region metadata for region ${regionIndex}:`, error);
    return limiter.getValue<RegionMetadata>(cacheKey) || null;
  }
}

export function getStrikeMeasurement(): StrikeMeasurement | null {
  if (!audioProcessor) return null;

  const cacheKey = 'strike_measurement';
  if (!limiter.shouldUpdate(cacheKey)) {
    return limiter.getValue<StrikeMeasurement>(cacheKey);
  }

  const measurement = audioProcessor.getStrikeMeasurement();
  if (!measurement) return null;

  // Now that strike detection is simplified, just return the measurement directly
  // The confidence comes from the harmonic system's statistical analysis
  limiter.setValue(cacheKey, measurement);
  return measurement;
}

export function setStrikeDetectionTrigger(minMagnitude: number) {
  if (!audioProcessor || !limiter.shouldUpdate('strike_trigger')) return;
  audioProcessor.setStrikeDetectionTrigger(minMagnitude);
}

export function setRequiredDecayingClusters(clusters: number) {
  if (!audioProcessor || !limiter.shouldUpdate('decaying_clusters')) return;
  audioProcessor.setRequiredDecayingClusters(clusters);
}

export function setHarmonicCapturePartialNumber(partialNumber: number) {
  if (!audioProcessor || partialNumber <= 0) return;
  audioProcessor.setHarmonicCapturePartialNumber(partialNumber);
}

export function setInharmonicityB(b: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setInharmonicityB(b);
}

export function setRegionCentsWindow(regionIndex: number, cents: number) {
  if (!audioProcessor) return;
  (audioProcessor as any).setRegionCentsWindow(regionIndex, cents);
}

// Note: Frequency stability methods removed - strike detection now uses magnitude-only trigger
// with harmonic system providing frequency measurements

// Store envelope max values in localStorage for persistence
const ENVELOPE_MAX_STORAGE_KEY = 'piano-tuner-envelope-max';

function saveEnvelopeMaxToStorage(regionIndex: number, value: number): void {
  try {
    const stored = localStorage.getItem(ENVELOPE_MAX_STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : {};
    data[regionIndex] = value;
    localStorage.setItem(ENVELOPE_MAX_STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save envelope max to localStorage:', error);
  }
}

function loadEnvelopeMaxFromStorage(regionIndex: number): number | null {
  try {
    const stored = localStorage.getItem(ENVELOPE_MAX_STORAGE_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored);
    return data[regionIndex] || null;
  } catch (error) {
    console.warn('Failed to load envelope max from localStorage:', error);
    return null;
  }
}

export function cleanup(): void {
  // Preserve envelope max values to localStorage across audio restarts
  for (let i = 0; i < INITIAL_REGIONS_COUNT; i++) {
    const maxValue = limiter.getValue<number>(`envelope_max_${i}`);
    if (maxValue !== undefined && maxValue !== null && maxValue > 0) {
      saveEnvelopeMaxToStorage(i, maxValue);
    }
  }

  cleanupAudioProcessor();
  audioProcessorModule = null;
  audioProcessor = null;
  isInitializing = false;
  pendingValues = {
    freqOverlapFactor: null,
    regions: Array.from({ length: INITIAL_REGIONS_COUNT }, () => ({
      frequency: null,
      isDisplayRegion: true,
    })),
  };
  limiter.clear();
}

export async function preloadWasmModules() {
  await Promise.all([initAudioProcessor()]);
}

export function setRegionFrequency(
  regionIndex: number,
  frequency: number,
  isDisplayRegion: boolean = true
) {
  const cacheKey = `set_region_freq_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) return;

  if (audioProcessor) {
    audioProcessor.setRegionFrequency(regionIndex, frequency, isDisplayRegion);
  } else {
    if (regionIndex >= 0 && regionIndex < pendingValues.regions.length) {
      pendingValues.regions[regionIndex] = {
        ...pendingValues.regions[regionIndex],
        frequency,
        isDisplayRegion,
      };
    }
  }
}

export function getRegionEnvelopeMax(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `envelope_max_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionEnvelopeMax(regionIndex);
  limiter.setValue(cacheKey, value);

  // Save to localStorage for persistence across restarts
  if (value > 0) {
    saveEnvelopeMaxToStorage(regionIndex, value);
  }

  return value;
}

export function resetRegionEnvelopeMax(regionIndex: number) {
  const cacheKey = `reset_env_max_${regionIndex}`;
  if (!audioProcessor || !limiter.shouldUpdate(cacheKey)) return;
  audioProcessor.resetRegionEnvelopeMax(regionIndex);
}

export function getRegionEnvelopeMin(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `envelope_min_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionEnvelopeMin(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function resetRegionEnvelopeMin(regionIndex: number) {
  const cacheKey = `reset_env_min_${regionIndex}`;
  if (!audioProcessor || !limiter.shouldUpdate(cacheKey)) return;
  audioProcessor.resetRegionEnvelopeMin(regionIndex);
}

export function setRegionEnvelopeMax(regionIndex: number, value: number) {
  const cacheKey = `set_env_max_${regionIndex}`;
  if (!audioProcessor || !limiter.shouldUpdate(cacheKey)) return;
  audioProcessor.setRegionEnvelopeMax(regionIndex, value);
}

export function setRegionEnvelopeMin(regionIndex: number, value: number) {
  const cacheKey = `set_env_min_${regionIndex}`;
  if (!audioProcessor || !limiter.shouldUpdate(cacheKey)) return;
  audioProcessor.setRegionEnvelopeMin(regionIndex, value);
}

export function getRegionBinCount(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `bin_count_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionBinCount(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionFrequencyPerBin(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `freq_per_bin_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionFrequencyPerBin(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionStartFrequency(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `start_freq_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionStartFrequency(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionEndFrequency(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `end_freq_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionEndFrequency(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function updateAudioProcessor() {
  if (!audioProcessor) return;

  if (pendingValues.freqOverlapFactor !== null) {
    audioProcessor.setFreqOverlapFactor(pendingValues.freqOverlapFactor);
    pendingValues.freqOverlapFactor = null;
  }

  // Apply pending region settings
  pendingValues.regions.forEach((region, index) => {
    if (region.frequency !== null) {
      audioProcessor?.setRegionFrequency(index, region.frequency, region.isDisplayRegion);
    }
  });
}

export function getRegionHighestMagnitude(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `highest_mag_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionHighestMagnitude(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionPeakFrequency(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `peak_freq_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionPeakFrequency(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionPeakMagnitude(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `peak_mag_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionPeakMagnitude(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionPeakConfidence(regionIndex: number): number {
  if (!audioProcessor) return 0;
  const cacheKey = `peak_conf_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getRegionPeakConfidence(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export function getRegionPeakBin(regionIndex: number): number {
  if (!audioProcessor) return -1;
  const cacheKey = `peak_bin_${regionIndex}`;
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? -1;
  }
  const value = audioProcessor.getRegionPeakBin(regionIndex);
  limiter.setValue(cacheKey, value);
  return value;
}

export type StrikeState = 'WAITING' | 'ATTACK' | 'MONITORING';

export function getStrikeState(): StrikeState {
  if (!audioProcessor) return 'WAITING';
  const cacheKey = 'strike_state';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<StrikeState>(cacheKey);
    return cached ?? 'WAITING';
  }
  const value = audioProcessor.getStrikeState() as StrikeState;
  limiter.setValue(cacheKey, value);
  return value;
}

export function isInMeasurementWindow(): boolean {
  if (!audioProcessor) return false;
  const cacheKey = 'measurement_window';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<boolean>(cacheKey);
    return cached ?? false;
  }
  const value = audioProcessor.isInMeasurementWindow();
  limiter.setValue(cacheKey, value);
  return value;
}

export function resetStrikeDetection(): void {
  if (!audioProcessor || !limiter.shouldUpdate('reset_strike')) return;
  audioProcessor.resetStrikeDetection();
}

export function getStrikeMeasurementFrequency(): number {
  if (!audioProcessor) return 0;
  const cacheKey = 'strike_freq';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getStrikeMeasurementFrequency();
  limiter.setValue(cacheKey, value);
  return value;
}

export function getStrikeMeasurementMagnitude(): number {
  if (!audioProcessor) return 0;
  const cacheKey = 'strike_mag';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getStrikeMeasurementMagnitude();
  limiter.setValue(cacheKey, value);
  return value;
}

export function getStrikeMeasurementTimestamp(): number {
  if (!audioProcessor) return 0;
  const cacheKey = 'strike_timestamp';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getStrikeMeasurementTimestamp();
  limiter.setValue(cacheKey, value);
  return value;
}

export function getStrikeMeasurementIsValid(): boolean {
  if (!audioProcessor) return false;
  const cacheKey = 'strike_valid';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<boolean>(cacheKey);
    return cached ?? false;
  }
  const value = audioProcessor.getStrikeMeasurementIsValid();
  limiter.setValue(cacheKey, value);
  return value;
}

export function getCurrentMagnitudeThreshold(): number {
  if (!audioProcessor) return 0;
  const cacheKey = 'magnitude_threshold';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getCurrentMagnitudeThreshold();
  limiter.setValue(cacheKey, value);
  return value;
}

export function processAudioDirect(inputBuffer: Float32Array, sampleRate: number): void {
  if (!audioProcessor || !audioProcessorModule) {
    throw new Error('Audio processor not initialized');
  }

  try {
    // Calculate required size with alignment
    const bytesPerFloat = 4;
    const requiredSize = inputBuffer.length * bytesPerFloat + ALIGNMENT;

    // Only reallocate if necessary - avoid frequent allocation/deallocation
    if (!staticInputPtr || currentAllocatedSize < requiredSize) {
      // If we need more memory, increase by a larger amount to reduce future reallocations
      const newSize = Math.max(requiredSize, currentAllocatedSize * 1.5);

      // Free existing allocation if it exists
      if (staticInputPtr) {
        audioProcessorModule._free(staticInputPtr);
        staticInputPtr = null;
      }

      // Allocate new memory
      staticInputPtr = audioProcessorModule._malloc(newSize);
      if (!staticInputPtr) {
        throw new Error('Failed to allocate memory in WASM');
      }
      currentAllocatedSize = newSize;
    }

    // Calculate aligned address - ensure proper alignment
    const alignedInputPtr = Math.ceil(staticInputPtr / ALIGNMENT) * ALIGNMENT;

    // Create view into the WASM memory for input
    const inputView = new Float32Array(
      audioProcessorModule.HEAPF32.buffer,
      alignedInputPtr,
      inputBuffer.length
    );

    // Copy input data
    inputView.set(inputBuffer);

    // Process audio
    audioProcessor.processAudioDirect(
      alignedInputPtr,
      alignedInputPtr,
      inputBuffer.length,
      sampleRate
    );
  } catch (error) {
    // Don't free memory on error - just log it to avoid allocation churn
    console.error('Error in processAudioDirect:', error);
    throw error;
  }
}

export function cleanupAudioProcessor(): void {
  if (staticInputPtr && audioProcessorModule) {
    audioProcessorModule._free(staticInputPtr);
    staticInputPtr = null;
    currentAllocatedSize = 0;
  }
}

export function getStrikeDetectionTrigger(): number {
  if (!audioProcessor) return 0.3;
  return audioProcessor.getStrikeDetectionTrigger();
}

export function getRequiredDecayingClusters(): number {
  if (!audioProcessor) return 3;
  return audioProcessor.getRequiredDecayingClusters();
}

export function halveRegionDisplayEnvelope(regionIndex: number) {
  const cacheKey = `halve_env_${regionIndex}`;
  if (!audioProcessor || !limiter.shouldUpdate(cacheKey)) return;
  audioProcessor.halveRegionDisplayEnvelope(regionIndex);
}

export function clearStrikeMeasurement() {
  if (!audioProcessor || !limiter.shouldUpdate('clear_strike')) return;
  audioProcessor.clearStrikeMeasurement();
}

export function getStrikeMeasurementConfidence(): number {
  if (!audioProcessor) return 0;
  const cacheKey = 'strike_confidence';
  if (!limiter.shouldUpdate(cacheKey)) {
    const cached = limiter.getValue<number>(cacheKey);
    return cached ?? 0;
  }
  const value = audioProcessor.getStrikeMeasurementConfidence();
  limiter.setValue(cacheKey, value);
  return value;
}

export function isSIMDEnabled(): boolean {
  if (!audioProcessor) return false;
  return audioProcessor.isSIMDEnabled();
}

// Store pending callback until AudioProcessor is ready
let _pendingHarmonicCaptureCallback: ((strikeMeasurement: StrikeMeasurement) => void) | null = null;
// Support multiple JS listeners for strike start; dispatch through a single WASM callback
const _strikeStartListeners = new Set<
  (event: {
    timestamp: number;
    frequency: number;
    selectedPartial: number;
    displayRegionHarmonicIndex: number;
    strikeId: number;
  }) => void
>();
let _strikeStartDispatcherRegistered = false;

/**
 * Register a JavaScript callback for harmonic capture completion
 * This replaces the polling mechanism with event-driven notifications
 */
export function registerHarmonicCaptureCallback(
  callback: (strikeMeasurement: StrikeMeasurement) => void
): void {
  if (!audioProcessor) {
    // Debug disabled for performance: AudioProcessor not ready yet, storing callback for later registration
    _pendingHarmonicCaptureCallback = callback;
    return;
  }

  audioProcessor.setHarmonicCaptureCallback(callback);
  // Debug disabled for performance: Registered harmonic capture callback - no more polling!
}

/**
 * Register a JavaScript callback for strike start (MONITORING transition)
 */
export function registerStrikeStartCallback(
  callback: (event: {
    timestamp: number;
    frequency: number;
    selectedPartial: number;
    displayRegionHarmonicIndex: number;
    strikeId: number;
  }) => void
): void {
  _strikeStartListeners.add(callback);
  // Ensure dispatcher is installed when processor is available
  const installDispatcher = () => {
    if (!audioProcessor || _strikeStartDispatcherRegistered) return;
    const apAny = audioProcessor as any;
    if (typeof apAny.setStrikeStartCallback === 'function') {
      apAny.setStrikeStartCallback((evt: any) => {
        _strikeStartListeners.forEach(listener => {
          try {
            listener(evt);
          } catch (e) {
            console.warn('StrikeStart listener error:', e);
          }
        });
      });
      _strikeStartDispatcherRegistered = true;
    }
  };
  installDispatcher();
}

/**
 * Enable or disable harmonic capture globally (for battery optimization)
 * When disabled, no harmonic regions are created and no FFT processing occurs
 */
export function setHarmonicCaptureEnabled(enabled: boolean): void {
  if (!audioProcessor) {
    console.warn('⚠️ AudioProcessor not ready - cannot set harmonic capture state');
    return;
  }

  audioProcessor.setHarmonicCaptureEnabled(enabled);
  // Debug disabled for performance: Harmonic capture ${enabled ? 'ENABLED' : 'DISABLED'} for battery optimization
}
