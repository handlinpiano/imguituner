#include <algorithm>
#include <cmath>
#include <complex>
#include <memory>
#include <string>
#include <vector>
#include <array>
#include <limits>

#include <emscripten/val.h>
#include <emscripten/emscripten.h>

#include "types.hpp"
#include "regions.hpp"
#include "zoom_engine.hpp"
#include "audio_processor.hpp"
#include "strike_tracker.hpp"
#include "capture_engine.hpp"

// Compile-time kill switch for all printf in production builds
#ifdef DISABLE_PRINTF
#undef printf
#define printf(...) do {} while (0)
#endif

namespace AudioConfig {
    constexpr float PI = 3.14159265358979323846f;
    constexpr int MAX_OVERLAP = 32;
    constexpr int FFT_SIZE = 32768; // legacy constant (not used in Zoom path)
}

// Simple aligned allocation helpers
namespace AudioUtils {
    template <typename T>
    T* alignedAlloc(size_t count, size_t alignment = 32) {
        void* ptr = nullptr;
        if (posix_memalign(&ptr, alignment, count * sizeof(T)) != 0) {
            return nullptr;
        }
        return static_cast<T*>(ptr);
    }
    template <typename T>
    void alignedFree(T* ptr) { free(ptr); }
}

// Lightweight buffers holder
struct AudioBuffers {
    std::unique_ptr<float, void(*)(float*)> compositeFFTOut;
    AudioBuffers(int totalBins)
        : compositeFFTOut(AudioUtils::alignedAlloc<float>(totalBins), AudioUtils::alignedFree<float>) {}
};

// ================== AudioProcessor implementation ==================

class AudioProcessorImpl {
public:
    int sampleRate = 0;
    int zoomDecimation = 16;
    int zoomFftSize = 16384;
    int zoomNumBins = 1200;
    int zoomWindowType = 0; // 0=Hann

    int activeRegions = 0;
    std::array<FrequencyRegion, AudioConfig::MAX_REGIONS> regions{};
    std::unique_ptr<AudioBuffers> buffers;
    StrikeTracker strikeTracker;
    StrikeTrackerConfig strikeConfig{};
    // Strike line capture + callback
    StrikeState prevStrikeState = StrikeState::WAITING;
    long long nextStrikeId = 1;
    StrikeMeasurement lastStrikeMeasurement{};
    emscripten::val strikeStartCallback = emscripten::val::null();
    emscripten::val harmonicCaptureCallback = emscripten::val::null();
    std::unique_ptr<CaptureEngine> capture = std::make_unique<CaptureEngine>();
    int selectedPartialNumber = 1; // 1..8
    // Global inharmonicity (per note) provided by JS (0 means disabled)
    double inharmonicityB = 0.0;
    // Whether to auto-center regions to ideal multiples when region 0 updates
    bool autoHarmonicCentersEnabled = true;

    // Immediate single-frame capture control
    bool pendingImmediateCapture = false;

    // Strike/capture placeholders
    emscripten::val lineUpdateCallback = emscripten::val::null();
    bool harmonicCaptureEnabled = true;
    float strikeMinMagnitude = 0.3f;
    int strikeRequiredDecayingClusters = 3; // legacy external setting (overridden dynamically)
    int lastAppliedDecayingClusters = -1;
    double processedSamples = 0.0; // for wall-clock seconds
    double lastPeakLogMs = 0.0;    // periodic debug logging

    AudioProcessorImpl()
    {
        // Allocate composite buffer
        buffers = std::make_unique<AudioBuffers>(AudioConfig::MAX_REGIONS * zoomNumBins);
        std::fill_n(buffers->compositeFFTOut.get(), AudioConfig::MAX_REGIONS * zoomNumBins, 0.0f);

        // Init regions
        for (int i = 0; i < AudioConfig::MAX_REGIONS; ++i) {
            regions[i] = FrequencyRegion{};
            regions[i].envelopeMagnitude = 5.0; // proven stable default
            regions[i].envelopeMin = regions[i].envelopeMagnitude * 0.1;
            regions[i].active = false;
            regions[i].isDisplayRegion = (i == 0);
        }
        strikeTracker.setSampleRate(sampleRate);
        // Ensure retrigger high default is 75% per simplified logic
        strikeConfig.retriggerHighThreshold = 0.75f;
        strikeTracker.setConfig(strikeConfig);
    }

private:
    static double clamp01(double v) { return std::max(0.0, std::min(1.0, v)); }
    static double psychoScale(double norm) {
        // 0..1 normalized → log10 scaled 0..1 perceptual
        return (norm <= 0.0) ? 0.0 : clamp01(std::log10(norm * 9.0 + 1.0));
    }

    void performSingleFrameCapture(double nowMs)
    {
        // Reference region based on selected partial (k), fallback to region 0
        int refIndex = std::max(0, selectedPartialNumber - 1);
        if (refIndex >= activeRegions || !regions[refIndex].active || regions[refIndex].peakFrequency <= 0.0) {
            refIndex = 0;
            if (refIndex >= activeRegions || !regions[0].active || regions[0].peakFrequency <= 0.0) return;
        }
        const double f_k = regions[refIndex].peakFrequency;
        const double k = (refIndex == 0) ? 1.0 : static_cast<double>(selectedPartialNumber);
        const double f0 = (f_k > 0.0 && k > 0.0) ? (f_k / k) : 0.0;
        if (f0 <= 0.0) return;

        std::array<HarmonicStatistics, 8> stats{};
        int validCount = 0;
        // Use H1 raw magnitude as baseline for relative partial strengths
        const double baseRawMag = (activeRegions > 0) ? std::max(0.0, regions[0].regionHighestMagnitude) : 0.0;
        for (int i = 0; i < 8 && i < activeRegions; ++i) {
            HarmonicStatistics hs{};
            if (regions[i].active && regions[i].peakFrequency > 0.0) {
                const double f_i = regions[i].peakFrequency;
                const double ratio = (f_i > 0.0) ? (f_i / f0) : 0.0;
                if (ratio > 0.0) {
                    const int harmonicNumber = i + 1;
                    // Predicted expected ratio with inharmonicity: n * sqrt(1 + B*n^2)
                    double expected = static_cast<double>(harmonicNumber);
                    if (inharmonicityB > 0.0) {
                        const double n2 = static_cast<double>(harmonicNumber * harmonicNumber);
                        expected = static_cast<double>(harmonicNumber) * std::sqrt(1.0 + inharmonicityB * n2);
                    }
                    const double centsDev = 1200.0 * std::log2(ratio / expected);
                    const double gateCents = std::max(5.0, regions[i].centsWindow);
                    if (centsDev < -2.0 || centsDev > gateCents) {
                        // Reject out-of-band partial
                    } else {
                        // Relative magnitude using raw magnitudes: Hi_raw / H1_raw
                        const double rawMag = std::max(0.0, regions[i].regionHighestMagnitude);
                        double mRel = 0.0;
                        if (baseRawMag > 0.0) {
                            mRel = rawMag / baseRawMag;
                        }
                        // Clamp to 0..1 before psycho scaling
                        mRel = clamp01(mRel);
                        const double c = clamp01(regions[i].peakConfidence);
                        const double mPsy = psychoScale(mRel);

                        hs.is_valid = true;
                        hs.frequency_mean = ratio;            // mapped to ratio_mean in bindings
                        hs.ratio_std = 0.0;
                        hs.magnitude_mean = mRel;
                        hs.magnitude_median_scaled = mPsy;    // mapped to magnitude_median
                        // Use magnitude_std field to carry SNR (linear ratio) for single-frame capture
                        hs.magnitude_std = std::max(0.0, regions[i].snrLinear);
                        hs.confidence_mean = c;
                        hs.sample_count = 1;
                        hs.outlier_rate = 0.0;

                        // Optional diagnostics fields
                        hs.medianRatio = ratio;
                        hs.ratioStdDev = 0.0;
                        hs.averageMagnitude = mRel;
                        hs.medianMagnitude = mPsy;
                        hs.averageConfidence = c;
                        hs.validMeasurements = 1;

                        validCount++;
                    }
                }
            }
            stats[i] = hs;
        }

        // Populate StrikeMeasurement and emit
        lastStrikeMeasurement.timestamp = nowMs;
        lastStrikeMeasurement.frequency = regions[0].peakFrequency;
        lastStrikeMeasurement.magnitude = regions[0].peakMagnitude;
        lastStrikeMeasurement.confidence = regions[0].peakConfidence;
        lastStrikeMeasurement.isValid = (validCount > 0);
        lastStrikeMeasurement.aboveThreshold = true;
        lastStrikeMeasurement.inWindow = true;
        lastStrikeMeasurement.harmonicStatistics = stats;
        lastStrikeMeasurement.windowSampleCount = 1;
        lastStrikeMeasurement.windowDuration = 0.0;
        lastStrikeMeasurement.hasWindowData = true;
        lastStrikeMeasurement.displayRegionHarmonicIndex = std::max(0, selectedPartialNumber - 1);
        if (lastStrikeMeasurement.strikeId < 0) lastStrikeMeasurement.strikeId = nextStrikeId++;

        if (!harmonicCaptureCallback.isNull()) {
            harmonicCaptureCallback(lastStrikeMeasurement);
        }
    }

public:
    void ensureCompositeCapacity()
    {
        const int total = AudioConfig::MAX_REGIONS * zoomNumBins;
        if (!buffers->compositeFFTOut || total <= 0) {
            buffers = std::make_unique<AudioBuffers>(total);
        }
    }

public:
    void setRegionFrequency(int regionIndex, double frequency, bool isDisplayRegion)
    {
        if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS) return;
        if (frequency <= 0) {
            regions[regionIndex].active = false;
            if (regionIndex == activeRegions - 1) {
                while (activeRegions > 0 && !regions[activeRegions - 1].active) activeRegions--;
            }
            return;
        }

            double oldFrequency = regions[regionIndex].centerFrequency;
        bool isNew = oldFrequency != frequency || regions[regionIndex].isDisplayRegion != isDisplayRegion;
            regions[regionIndex].centerFrequency = frequency;
        regions[regionIndex].isDisplayRegion = isDisplayRegion;
        regions[regionIndex].active = true;

        // Assign contiguous slice
        const int start = regionIndex * zoomNumBins;
        regions[regionIndex].startBin = start;
        regions[regionIndex].endBin = start + zoomNumBins - 1;

        if (isNew) {
            // Proven reduction system on note change: 0.5 per note, 0.25 on octave jumps
                double octaveDiff = 0.0;
                if (oldFrequency > 0.0) {
                    octaveDiff = std::abs(std::log2(frequency / oldFrequency));
                }
            double reductionFactor = (octaveDiff >= 0.95) ? 0.25 : 0.5;
                regions[regionIndex].envelopeMagnitude = std::max(0.2, regions[regionIndex].envelopeMagnitude * reductionFactor);
                regions[regionIndex].envelopeMin = regions[regionIndex].envelopeMagnitude * 0.1;
                regions[regionIndex].rawMagnitude = 0.0;
            }

            activeRegions = std::max(activeRegions, regionIndex + 1);
        ensureCompositeCapacity();

        // Dynamically adjust strike decaying clusters based on display region 0 center frequency
        if (regionIndex == 0 && regions[0].centerFrequency > 0.0) {
            // Always keep H1..H8 regions active and centered
            if (autoHarmonicCentersEnabled) {
                const double f_k = regions[0].centerFrequency;
                const double k = std::max(1, selectedPartialNumber);
                const double f0 = f_k / static_cast<double>(k);
                if (f0 > 0.0) {
                    for (int idx = 0; idx < AudioConfig::MAX_REGIONS; ++idx) {
                        const int harmonicNumber = idx + 1;
                        const double targetHz = f0 * static_cast<double>(harmonicNumber);
                        // Keep region 0 as display; others non-display
                        if (idx == 0) {
                            // already set above
                        } else {
                            regions[idx].centerFrequency = targetHz;
                            regions[idx].isDisplayRegion = false;
                            regions[idx].active = true;
                            const int start = idx * zoomNumBins;
                            regions[idx].startBin = start;
                            regions[idx].endBin = start + zoomNumBins - 1;
                            activeRegions = std::max(activeRegions, idx + 1);
                        }
                    }
                    ensureCompositeCapacity();
                }
            }

            const double f = regions[0].centerFrequency;
            int req = 3;
            if (f < 100.0) req = 10;
            else if (f < 200.0) req = 8;
            else if (f < 600.0) req = 6;
            else if (f < 1500.0) req = 4;
            else req = 2;
            if (req != lastAppliedDecayingClusters) {
                strikeConfig.requiredDecayingClusters = req;
                strikeTracker.setConfig(strikeConfig);
                lastAppliedDecayingClusters = req;
            }
        }
    }

    void processRegion(int i, float* inputPtr, int size)
    {
        if (!regions[i].active || regions[i].centerFrequency <= 0.0) return;

        // Adaptive decimation based on center frequency
        // Higher frequencies need less decimation; per-region window in centsWindow
        int adaptiveDecimation = zoomDecimation; // Default fallback
        if (sampleRate > 0 && regions[i].centerFrequency > 0) {
            // Convert cents window to fractional bandwidth
            const double c = std::max(10.0, regions[i].centsWindow);
            const double fracPos = std::pow(2.0, c / 1200.0) - 1.0;
            const double fracNeg = 1.0 - std::pow(2.0, -c / 1200.0);
            const double frac = std::max(fracPos, fracNeg);
            // Add 50% margin for filter rolloff
            double requiredBandwidth = regions[i].centerFrequency * (frac * 1.5);
            // Decimated sample rate must be > 2 * requiredBandwidth
            double maxDecimation = sampleRate / (2.0 * requiredBandwidth);
            
            // Use power of 2 for efficiency, clamped between 4 and 32
            if (maxDecimation >= 32) adaptiveDecimation = 32;
            else if (maxDecimation >= 16) adaptiveDecimation = 16;
            else if (maxDecimation >= 8) adaptiveDecimation = 8;
            else adaptiveDecimation = 4;
        }

        zoom::ZoomConfig cfg{
            .decimation = adaptiveDecimation,
            .fftSize = zoomFftSize,
            .numBins = zoomNumBins,
            .windowType = zoomWindowType,
            .sampleRate = sampleRate,
        };

        auto mags = zoom::computeZoomMagnitudes(inputPtr, size, regions[i].centerFrequency, cfg);

        // Enforce physics-based looking window by masking bins outside the centsWindow
        const double allowCents = std::max(10.0, regions[i].centsWindow);
        for (int b = 0; b < zoomNumBins && b < (int)mags.size(); ++b) {
            const double pos = static_cast<double>(b);
            const double centsFromCenter = -120.0 + (240.0 * (pos / std::max(1, zoomNumBins - 1)));
            if (std::abs(centsFromCenter) > allowCents) {
                mags[b] = 0.0;
            }
        }

        // Analyze raw magnitudes
        int maxBin = 0;
        double currentMax = 0.0;
        double currentMin = std::numeric_limits<double>::max();
        double noiseAccum = 0.0;
        int noiseCount = 0;
        for (int b = 0; b < zoomNumBins && b < (int)mags.size(); ++b) {
            double v = mags[b];
            if (v > currentMax) { currentMax = v; maxBin = b; }
            if (v > 0.0) currentMin = std::min(currentMin, v);
            // Accumulate noise excluding a small window around the current peak
            if (b < maxBin - 2 || b > maxBin + 2) {
                noiseAccum += std::max(0.0, v);
                noiseCount++;
            }
        }

        // Update envelopes FIRST (so normalization reflects new top/bottom immediately)
        if (currentMax > regions[i].envelopeMagnitude) regions[i].envelopeMagnitude = currentMax;
        if (currentMin < regions[i].envelopeMin) regions[i].envelopeMin = currentMin;
        if (regions[i].envelopeMagnitude <= 0.0) regions[i].envelopeMagnitude = 0.2;
        if (regions[i].envelopeMin < 0.0) regions[i].envelopeMin = 0.0;
        if (regions[i].envelopeMin >= regions[i].envelopeMagnitude) {
            regions[i].envelopeMin = regions[i].envelopeMagnitude * 0.1;
        }

        regions[i].regionHighestMagnitude = currentMax;
        regions[i].peakBin = maxBin;
        // Estimate noise floor and SNR (raw domain)
        double noiseFloorRaw = 0.0;
        if (noiseCount > 0) noiseFloorRaw = std::max(0.0, noiseAccum / std::max(1, noiseCount));
        regions[i].noiseFloorRaw = noiseFloorRaw;
        regions[i].snrLinear = (noiseFloorRaw > 0.0) ? (currentMax / noiseFloorRaw) : 0.0;

        double centerHz = regions[i].centerFrequency;
        double peakFreq = centerHz;
        double peakMagRaw = currentMax;
        if (maxBin > 0 && maxBin < zoomNumBins - 1 && maxBin + 1 < (int)mags.size()) {
            double y0 = mags[maxBin - 1];
            double y1 = mags[maxBin];
            double y2 = mags[maxBin + 1];
            double denom = y0 - 2.0 * y1 + y2;
            double delta = 0.0;
            if (std::abs(denom) > 1e-6) {
                delta = 0.5 * (y0 - y2) / denom;
                delta = std::max(-0.5, std::min(0.5, delta));
            }
            double pos = static_cast<double>(maxBin) + delta;
            double cents = -120.0 + (240.0 * (pos / std::max(1, zoomNumBins - 1)));
            peakFreq = centerHz * std::pow(2.0, cents / 1200.0);
            peakMagRaw = y1 - 0.25 * (y0 - y2) * delta;
        }
        regions[i].peakFrequency = peakFreq;

        // Normalize and write into composite buffer for display regions
        const int startBin = regions[i].startBin;
        double maxNormalized = 0.0;
        const double envelopeRange = std::max(1e-12, regions[i].envelopeMagnitude - regions[i].envelopeMin);
        for (int b = 0; b < zoomNumBins; ++b) {
            double v = (b < (int)mags.size()) ? mags[b] : 0.0;
            if (v <= regions[i].envelopeMin) {
                v = 0.0;
            } else {
                v = (v - regions[i].envelopeMin) / envelopeRange;
                v = std::max(0.0, std::min(1.0, v));
            }
            maxNormalized = std::max(maxNormalized, v);
            buffers->compositeFFTOut.get()[startBin + b] = static_cast<float>(v);
        }

        // Peak magnitude reported as normalized (for UI)
        double peakMagNorm;
        if (peakMagRaw <= regions[i].envelopeMin) peakMagNorm = 0.0;
        else peakMagNorm = std::max(0.0, std::min(1.0, (peakMagRaw - regions[i].envelopeMin) / envelopeRange));
        regions[i].peakMagnitude = peakMagNorm;

        // Confidence: use normalized peak magnitude (simple, robust)
        regions[i].peakConfidence = std::max(0.0, std::min(1.0, peakMagNorm));

        // Raw stats for capture/diagnostics
        regions[i].rawMagnitude = currentMax;
        regions[i].regionHighestMagnitude = currentMax;

        // Update strike tracker on display region
        if (i == 0) {
            const StrikeState before = strikeTracker.state();
            strikeTracker.update(
                currentMax,                   // raw peak
                regions[0].envelopeMagnitude, // envelope max
                regions[0].peakFrequency,     // peak frequency
                size                          // frame size
            );
            const StrikeState after = strikeTracker.state();

            // Continuously keep decaying clusters aligned with current display region
            if (regions[0].centerFrequency > 0.0) {
                const double f = regions[0].centerFrequency;
                int req = lastAppliedDecayingClusters;
                if (f < 100.0) req = 10;
                else if (f < 200.0) req = 8;
                else if (f < 600.0) req = 6;
                else if (f < 1500.0) req = 4;
                else req = 2;
                if (req != lastAppliedDecayingClusters) {
                    strikeConfig.requiredDecayingClusters = req;
                    strikeTracker.setConfig(strikeConfig);
                    lastAppliedDecayingClusters = req;
                }
            }
            
            // BEGIN on enter ATTACK
            if (before != StrikeState::ATTACK && after == StrikeState::ATTACK) {
                // Use emscripten monotonic clock (ms) for cross-thread safe timing
                lastStrikeMeasurement.timestamp = emscripten_get_now();
                lastStrikeMeasurement.frequency = strikeTracker.getMeasuredFrequency();
                lastStrikeMeasurement.magnitude = regions[0].peakMagnitude; // normalized
                lastStrikeMeasurement.confidence = regions[0].peakConfidence;
                lastStrikeMeasurement.isValid = true;
                lastStrikeMeasurement.aboveThreshold = true;
                lastStrikeMeasurement.inWindow = true;
                lastStrikeMeasurement.windowSampleCount = 0;
                lastStrikeMeasurement.windowDuration = 0;
                lastStrikeMeasurement.hasWindowData = false;
                lastStrikeMeasurement.displayRegionHarmonicIndex = std::max(0, selectedPartialNumber - 1);
                lastStrikeMeasurement.strikeId = nextStrikeId++;
                // Optional: set diagnostics defaults
                lastStrikeMeasurement.unisonDetected = false;
                lastStrikeMeasurement.unisonReasonMask = 0;
                lastStrikeMeasurement.windowPeakJitterCents = 0.0; // Simplified - no jitter calculation
                lastStrikeMeasurement.windowEnvelopeLFPower = 0;
                lastStrikeMeasurement.windowCoherence = 0;

                // No multi-frame capture window anymore

                // Emit JS callback for history persistence
                if (!strikeStartCallback.isNull()) {
                    emscripten::val evt = emscripten::val::object();
                    evt.set("timestamp", lastStrikeMeasurement.timestamp);
                    evt.set("frequency", lastStrikeMeasurement.frequency);
                    evt.set("selectedPartial", selectedPartialNumber);
                    evt.set("displayRegionHarmonicIndex", std::max(0, selectedPartialNumber - 1));
                    evt.set("strikeId", lastStrikeMeasurement.strikeId);
                    strikeStartCallback(evt);
                }
            }

            // On MONITORING entry, perform single-frame capture on next processed block
            if (before != StrikeState::MONITORING && after == StrikeState::MONITORING) {
                pendingImmediateCapture = true;
            }

            // If retrigger detected while monitoring, capture immediately
            if (strikeTracker.hasRetrigger()) {
                try { performSingleFrameCapture(emscripten_get_now()); } catch (...) {}
                strikeTracker.clearRetrigger();
            }
        }
    }

public:
    void processAudio(float* inputPtr, int size, int currentSampleRate)
    {
        if (sampleRate == 0 || (currentSampleRate > 0 && currentSampleRate != sampleRate)) {
            sampleRate = currentSampleRate;
            strikeTracker.setSampleRate(sampleRate);
            processedSamples = 0.0;
        }
        ensureCompositeCapacity();
        std::fill_n(buffers->compositeFFTOut.get(), AudioConfig::MAX_REGIONS * zoomNumBins, 0.0f);

        for (int i = 0; i < activeRegions; ++i) {
            processRegion(i, inputPtr, size);
        }

        // Perform pending immediate single-frame capture (one-block defer after MONITORING entry)
        if (pendingImmediateCapture) {
            try { performSingleFrameCapture(emscripten_get_now()); } catch (...) {}
            pendingImmediateCapture = false;
        }

        // Advance time
        processedSamples += size;

        // Periodic debug: print peak frequencies once per second
        const double nowMs = emscripten_get_now();
        if (nowMs - lastPeakLogMs >= 1000.0) {
            try {
                std::string msg = "📈 Peaks: ";
                msg += "regions=" + std::to_string(activeRegions);
                for (int r = 0; r < activeRegions; ++r) {
                    if (!regions[r].active) continue;
                    msg += " | R" + std::to_string(r) + ":" +
                           std::to_string(regions[r].peakFrequency) + "Hz@" +
                           std::to_string(regions[r].peakMagnitude);
                }
                emscripten::val::global("console").call<void>("log", emscripten::val(msg));
            } catch (...) {}
            lastPeakLogMs = nowMs;
        }
    }
};

// ================== Public API (header-defined) ==================

AudioProcessor::AudioProcessor()
    : impl(new AudioProcessorImpl()) {}

AudioProcessor::~AudioProcessor() = default;

void AudioProcessor::processAudioDirectJS(emscripten::val inputPtr, emscripten::val /*outputPtr*/, int size, int currentSampleRate)
{
    auto addr = inputPtr.as<uintptr_t>();
    float* in = reinterpret_cast<float*>(addr);
    impl->processAudio(in, size, currentSampleRate);
}

void AudioProcessor::setFreqOverlapFactor(int /*factor*/) { /* no-op under Zoom engine */ }

void AudioProcessor::setRegionFrequency(int regionIndex, double frequency, bool isDisplayRegion)
{
    impl->setRegionFrequency(regionIndex, frequency, isDisplayRegion);
}

double AudioProcessor::getRegionEnvelopeMax(int regionIndex) { return (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS)? impl->regions[regionIndex].envelopeMagnitude : 0.0; }
double AudioProcessor::getRegionEnvelopeMin(int regionIndex) { return (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS)? impl->regions[regionIndex].envelopeMin : 0.0; }
void AudioProcessor::resetRegionEnvelopeMax(int regionIndex) { if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].envelopeMagnitude = 0.2; }
void AudioProcessor::resetRegionEnvelopeMin(int regionIndex) { if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].envelopeMin = 0.0; }
void AudioProcessor::setRegionEnvelopeMax(int regionIndex, double v) { if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].envelopeMagnitude = v; }
void AudioProcessor::setRegionEnvelopeMin(int regionIndex, double v) { if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].envelopeMin = v; }
void AudioProcessor::halveRegionDisplayEnvelope(int regionIndex) { if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].envelopeMagnitude *= 0.5; }
void AudioProcessor::setRegionCentsWindow(int regionIndex, double cents) {
    if (regionIndex>=0&&regionIndex<AudioConfig::MAX_REGIONS) impl->regions[regionIndex].centsWindow = std::max(5.0, std::min(180.0, cents));
}

std::vector<float> AudioProcessor::getRegionData(int regionIndex)
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return {};
    int start = impl->regions[regionIndex].startBin;
    int len = impl->regions[regionIndex].endBin - start + 1;
    if (len <= 0) return {};
    std::vector<float> out(len);
    std::copy_n(impl->buffers->compositeFFTOut.get() + start, len, out.begin());
    return out;
}

int AudioProcessor::getRegionBinCount(int regionIndex)
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0;
    return impl->regions[regionIndex].endBin - impl->regions[regionIndex].startBin + 1;
}

double AudioProcessor::getRegionFrequencyPerBin(int regionIndex)
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    const double center = impl->regions[regionIndex].centerFrequency;
    int binCount = getRegionBinCount(regionIndex);
    if (center <= 0.0 || binCount <= 1) return 0.0;
    const double startF = center * std::pow(2.0, -120.0 / 1200.0);
    const double endF = center * std::pow(2.0,  120.0 / 1200.0);
    return (endF - startF) / static_cast<double>(binCount - 1);
}

double AudioProcessor::getRegionStartFrequency(int regionIndex)
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    const double center = impl->regions[regionIndex].centerFrequency;
    return (center > 0.0) ? center * std::pow(2.0, -120.0 / 1200.0) : 0.0;
}

double AudioProcessor::getRegionEndFrequency(int regionIndex)
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    const double center = impl->regions[regionIndex].centerFrequency;
    return (center > 0.0) ? center * std::pow(2.0, 120.0 / 1200.0) : 0.0;
}

double AudioProcessor::getRegionHighestMagnitude(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    return impl->regions[regionIndex].regionHighestMagnitude;
}

double AudioProcessor::getRegionPeakFrequency(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    return impl->regions[regionIndex].peakFrequency;
}

double AudioProcessor::getRegionPeakMagnitude(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    return impl->regions[regionIndex].peakMagnitude;
}

double AudioProcessor::getRegionPeakConfidence(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return 0.0;
    return impl->regions[regionIndex].peakConfidence;
}

int AudioProcessor::getRegionPeakBin(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return -1;
    return impl->regions[regionIndex].peakBin;
}

RegionMetadata AudioProcessor::getRegionMetadata(int regionIndex) const
{
    RegionMetadata md{};
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) return md;
    const FrequencyRegion& r = impl->regions[regionIndex];
    md.binCount = r.endBin - r.startBin + 1;
    const double center = r.centerFrequency;
    if (center > 0.0 && md.binCount > 1) {
        const double c = std::max(10.0, r.centsWindow);
        const double startF = center * std::pow(2.0, -c / 1200.0);
        const double endF = center * std::pow(2.0,  c / 1200.0);
        md.startFrequency = startF;
        md.endFrequency = endF;
        md.frequencyPerBin = (endF - startF) / static_cast<double>(md.binCount - 1);
    }
    md.envelopeMax = r.envelopeMagnitude;
    md.envelopeMin = r.envelopeMin;
    md.highestMagnitude = r.regionHighestMagnitude;
    md.peakFrequency = r.peakFrequency;
    md.peakMagnitude = r.peakMagnitude;
    md.peakBin = r.peakBin;
    md.peakConfidence = r.peakConfidence;
    return md;
}

RegionDataView AudioProcessor::getRegionDataView(int regionIndex) const
{
    if (regionIndex < 0 || regionIndex >= AudioConfig::MAX_REGIONS || !impl->regions[regionIndex].active) {
        return {0, 0, 0, 0};
    }
    const FrequencyRegion& r = impl->regions[regionIndex];
    int start = std::max(0, r.startBin);
    int end = std::min(AudioConfig::MAX_REGIONS * impl->zoomNumBins - 1, r.endBin);
    int len = end - start + 1;
    if (len <= 0) return {0, 0, 0, 0};
    return { reinterpret_cast<std::uintptr_t>(impl->buffers->compositeFFTOut.get() + start), len, start, end };
}

// Strike/capture placeholders to satisfy API
std::string AudioProcessor::getStrikeState() const {
    switch (impl->strikeTracker.state()) {
        case StrikeState::WAITING: return "WAITING";
        case StrikeState::ATTACK: return "ATTACK";
        case StrikeState::MONITORING: return "MONITORING";
    }
    return "WAITING";
}
bool AudioProcessor::isInMeasurementWindow() const { return impl->capture && impl->capture->isActive(); }
StrikeMeasurement AudioProcessor::getStrikeMeasurement() const { return impl->lastStrikeMeasurement; }
void AudioProcessor::clearStrikeMeasurement() { impl->lastStrikeMeasurement = StrikeMeasurement{}; }
void AudioProcessor::resetStrikeDetection() { /* handled internally by strike tracker */ }
double AudioProcessor::getStrikeMeasurementFrequency() const { return impl->lastStrikeMeasurement.frequency; }
double AudioProcessor::getStrikeMeasurementMagnitude() const { return impl->lastStrikeMeasurement.magnitude; }
double AudioProcessor::getStrikeMeasurementConfidence() const { return impl->lastStrikeMeasurement.confidence; }
double AudioProcessor::getStrikeMeasurementTimestamp() const { return impl->lastStrikeMeasurement.timestamp; }
int AudioProcessor::getStrikeMeasurementSampleCount() const { return impl->lastStrikeMeasurement.windowSampleCount; }
bool AudioProcessor::getStrikeMeasurementIsValid() const { return impl->lastStrikeMeasurement.isValid; }
double AudioProcessor::getCurrentMagnitudeThreshold() const { return impl->regions[0].envelopeMagnitude * impl->strikeMinMagnitude; }
void AudioProcessor::setStrikeDetectionTrigger(float minMagnitude) { impl->strikeMinMagnitude = minMagnitude; }
void AudioProcessor::setRequiredDecayingClusters(int clusters) { impl->strikeRequiredDecayingClusters = clusters; }
void AudioProcessor::setHarmonicCapturePartialNumber(int partialNumber) { impl->selectedPartialNumber = std::max(1, partialNumber); }
float AudioProcessor::getStrikeDetectionTrigger() const { return impl->strikeMinMagnitude; }
int AudioProcessor::getRequiredDecayingClusters() const { return impl->strikeRequiredDecayingClusters; }
void AudioProcessor::setHarmonicCaptureCallback(emscripten::val callback) { impl->harmonicCaptureCallback = callback; }
void AudioProcessor::setStrikeStartCallback(emscripten::val cb) { impl->strikeStartCallback = cb; }
void AudioProcessor::setHarmonicCaptureEnabled(bool enabled) { impl->harmonicCaptureEnabled = enabled; }
void AudioProcessor::setInharmonicityB(double b) { impl->inharmonicityB = (std::isfinite(b) && b > 0.0) ? b : 0.0; }

// Zoom configuration
void AudioProcessor::setZoomDecimation(int decimation) { impl->zoomDecimation = std::max(1, decimation); }
void AudioProcessor::setZoomFftSize(int fftSize) { impl->zoomFftSize = std::max(8, fftSize); }
void AudioProcessor::setZoomNumBins(int numBins) {
    impl->zoomNumBins = std::max(8, numBins);
    // Reassign slices to preserve contiguous layout
    for (int i = 0; i < AudioConfig::MAX_REGIONS; ++i) {
        impl->regions[i].startBin = i * impl->zoomNumBins;
        impl->regions[i].endBin = impl->regions[i].startBin + impl->zoomNumBins - 1;
    }
    impl->ensureCompositeCapacity();
}
void AudioProcessor::setZoomWindowType(int windowType) { impl->zoomWindowType = windowType; }
void AudioProcessor::setLineUpdateCallback(emscripten::val cb) { impl->lineUpdateCallback = cb; }
void AudioProcessor::beginHarmonicCapture(int partialNumber) {
    impl->selectedPartialNumber = std::max(1, partialNumber);
    const double nowSec = impl->processedSamples / std::max(1, impl->sampleRate);
    if (impl->harmonicCaptureEnabled && impl->capture) {
        impl->capture->begin(nowSec, 0.180, impl->selectedPartialNumber);
        impl->capture->setInharmonicityB(impl->inharmonicityB);
    }
}
void AudioProcessor::abortHarmonicCapture() { if (impl->capture) impl->capture->abort(); }


