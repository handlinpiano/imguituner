// types.hpp
// Shared plain structs used across the WASM audio processor and JS bindings

#pragma once

#include <array>
#include <vector>
#include <cstdint>

// Individual ratio measurement from a cluster
struct HarmonicRatioMeasurement {
    double ratio;           // H2/H1 = 2.004 (the actual inharmonicity)
    double confidence;      // How confident we are in this measurement
    double magnitude;       // Signal strength at this moment
    double timestamp;       // When this was measured
    int frameIndex;         // Which sample frame this came from

    HarmonicRatioMeasurement()
        : ratio(0), confidence(0), magnitude(0), timestamp(0), frameIndex(-1) {}
};

// Statistical results from window analysis - focused on inharmonicity ratios
struct HarmonicStatistics {
    std::vector<HarmonicRatioMeasurement> ratioMeasurements; // Optional detailed samples
    double medianRatio;            // Most reliable ratio value (H2/H1, H3/H1, etc.)
    double ratioStdDev;            // Consistency of the ratio measurements
    double averageConfidence;      // Average confidence
    double averageMagnitude;       // Average magnitude
    double medianMagnitude;        // Median magnitude
    int validMeasurements;         // Count of good measurements
    bool is_valid;                 // Whether data is reliable

    // Legacy/compat fields used by embind surface
    double frequency_mean;         // Used as ratio_mean in bindings
    double ratio_std;
    double magnitude_mean;
    double magnitude_median_scaled; // Display-scaled median magnitude
    double magnitude_std;
    double confidence_mean;
    int sample_count;
    double outlier_rate;

    HarmonicStatistics()
        : medianRatio(0), ratioStdDev(0), averageConfidence(0), averageMagnitude(0),
          medianMagnitude(0), validMeasurements(0), is_valid(false),
          frequency_mean(0), ratio_std(0), magnitude_mean(0), magnitude_median_scaled(0),
          magnitude_std(0), confidence_mean(0), sample_count(0), outlier_rate(0) {}
};

// Batch region metadata for JS
struct RegionMetadata {
    // Frequency analysis properties
    int binCount;                // Number of frequency bins in the analysis
    double frequencyPerBin;      // Hz per frequency bin
    double startFrequency;       // Lower bound of analyzed frequency range (Hz)
    double endFrequency;         // Upper bound of analyzed frequency range (Hz)

    // Amplitude measurements
    double envelopeMax;          // Maximum amplitude envelope value
    double envelopeMin;          // Minimum amplitude envelope value
    double highestMagnitude;     // Highest magnitude found in region

    // Peak detection data
    double peakFrequency;        // Detected peak frequency with sub-bin accuracy
    double peakMagnitude;        // Magnitude at the detected peak
    int peakBin;                 // Bin index of the detected peak
    double peakConfidence;       // Confidence metric for the peak detection (0-1)
};

// Direct memory access structure for zero-copy region data
struct RegionDataView {
    std::uintptr_t dataPtr;  // Memory address as integer (safe for binding)
    int length;              // Number of elements
    int startBin;            // Starting bin index for validation
    int endBin;              // Ending bin index for validation
};

// Strike measurement snapshot delivered to JS
struct StrikeMeasurement {
    double timestamp;
    double frequency;
    double magnitude;
    double confidence;
    bool isValid;
    bool aboveThreshold;
    bool inWindow;

    // Window-based statistical harmonic measurements
    std::array<HarmonicStatistics, 8> harmonicStatistics; // H1-H8 statistical analysis
    int windowSampleCount;                                 // Samples collected in window
    double windowDuration;                                 // Duration of window (ms)
    bool hasWindowData;                                    // Whether window-based data is available
    int displayRegionHarmonicIndex;                        // Which harmonic (0-7) was display region
    long long strikeId;                                    // Unique ID to correlate start/complete

    // Unison/diagnostics (new)
    bool unisonDetected;           // True if unison activity likely present during capture
    int unisonReasonMask;          // Bitmask of reasons (beats, jitter, multi-peak, coherence)
    double windowPeakJitterCents;  // Stddev of peak cents during window
    double windowEnvelopeLFPower;  // Low-frequency envelope energy indicator (0-1 approx)
    double windowCoherence;        // Baseband coherence [0-1]

    StrikeMeasurement()
        : timestamp(0), frequency(0), magnitude(0), confidence(0),
          isValid(false), aboveThreshold(false), inWindow(false),
          harmonicStatistics({}), windowSampleCount(0), windowDuration(0), hasWindowData(false),
          displayRegionHarmonicIndex(-1), strikeId(-1),
          unisonDetected(false), unisonReasonMask(0), windowPeakJitterCents(0),
          windowEnvelopeLFPower(0), windowCoherence(0) {}
};


