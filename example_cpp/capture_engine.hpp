// capture_engine.hpp
#pragma once

#include <array>
#include <vector>
#include <algorithm>
#include <cmath>
#include "types.hpp"
#include "regions.hpp"

// Windowed harmonic capture engine using the selected partial as reference.
// Produces H1-frame ratios: ratio_i = f_i / f0, where f0 = f_k / k.
class CaptureEngine {
public:
    CaptureEngine() = default;
    void setInharmonicityB(double b) { inharmonicityB = (b > 0.0 && std::isfinite(b)) ? b : 0.0; }

    // Begin a capture window. We will capture a fixed number of frames, no timing logic.
    void begin(double startTimeSec, double /*durationSec*/, int selectedPartialNumber) {
        reset();
        active = true;
        startSec = startTimeSec;
        selectedPartial = std::max(1, selectedPartialNumber);
        displayRegionHarmonicIndex = selectedPartial - 1; // 0-based for UI

        // Fixed-frame capture (simple and robust)
        targetValidFrames = 8;
        maxFrames = 16;
        warmupSkipFrames = 0;
    }

    // Allow caller to set per-capture frame targets based on frequency range
    void setFrameTargets(int targetFrames, int maxFrameCount, int warmupSkip = 0) {
        targetValidFrames = std::max(1, targetFrames);
        maxFrames = std::max(targetValidFrames, maxFrameCount);
        warmupSkipFrames = std::max(0, warmupSkip);
    }

    void abort() { reset(); }

    bool isActive() const { return active; }
    // Finalize when we collected enough valid frames, or hit max frames guard
    bool isFinished(double nowSec) const {
        if (!active) return false;
        if (validRefFrames >= targetValidFrames) return true;
        if (frameCount >= maxFrames) return true;
        return false;
    }
    int getDisplayRegionHarmonicIndex() const { return displayRegionHarmonicIndex; }

    // Called once per processed audio block after regions are updated.
    // Uses selected partial (index k-1) as the sole reference; skips frame if unreliable.
    void recordFrame(double nowSec,
                     const std::array<FrequencyRegion, AudioConfig::MAX_REGIONS>& regions,
                     int activeRegions) {
        if (!active) return;
        if (nowSec < startSec) return;

        // Reference region index for selected partial (0-based)
        int refIndex = std::max(0, selectedPartial - 1);
        const bool refIndexInRange = (refIndex >= 0 && refIndex < activeRegions);
        const FrequencyRegion* refPtr = refIndexInRange ? &regions[refIndex] : nullptr;
        // Fallback to region 0 on first frame if selected partial region hasn't been processed yet
        if (!refPtr || !refPtr->active || refPtr->peakFrequency <= 0.0) {
            refIndex = 0;
            if (!(refIndex < activeRegions)) return;
            refPtr = &regions[0];
            if (!refPtr->active || refPtr->peakFrequency <= 0.0) return;
        }

        // Optional warmup skip (disabled by default)
        const double refMag = clamp01(refPtr->peakMagnitude);
        const double refConf = clamp01(refPtr->peakConfidence);
        if (warmupSkipFrames > 0) {
            warmupSkipFrames--;
            frameCount++;
            lastNowSec = nowSec;
            return;
        }

        const double f_k = refPtr->peakFrequency;
        // If we fell back to region 0 as ref, treat k as 1 (H1)
        const double k = (refIndex == 0) ? 1.0 : static_cast<double>(selectedPartial);
        if (f_k <= 0.0) return;

        // Derive f0 from selected partial
        const double f0 = f_k / k;
        if (f0 <= 0.0) return;

        // Collect ratios and ancillary stats for harmonics 1..8 with predicted-gate
        for (int i = 0; i < 8 && i < activeRegions; ++i) {
            const auto& r = regions[i];
            if (!r.active || r.peakFrequency <= 0.0) continue;

            const double f_i = r.peakFrequency;
            const double ratio = (f_i > 0.0) ? (f_i / f0) : 0.0; // H1-frame ratio
            if (ratio <= 0.0) continue;

            const int harmonicNumber = i + 1;
            // Predicted inharmonic expected = n * sqrt(1 + B * n^2)
            double expected = static_cast<double>(harmonicNumber);
            if (inharmonicityB > 0.0) {
                const double n2 = static_cast<double>(harmonicNumber * harmonicNumber);
                expected = static_cast<double>(harmonicNumber) * std::sqrt(1.0 + inharmonicityB * n2);
            }
            const double centsDev = 1200.0 * std::log2(ratio / expected);
            // Per-region gate: allow small negative (sensor jitter), upper bound from centsWindow
            const double gateCents = std::max(5.0, r.centsWindow);
            if (centsDev < -2.0) continue;
            if (centsDev > gateCents) continue;

            const double mag = clamp01(r.peakMagnitude);
            const double conf = clamp01(r.peakConfidence);

            ratioSamples[i].push_back(ratio);
            magSamples[i].push_back(mag);
            confSamples[i].push_back(conf);
        }

        validRefFrames++;
        frameCount++;
        lastNowSec = nowSec;
    }

    // Finalize the window into HarmonicStatistics array and window metadata.
    void finalize(std::array<HarmonicStatistics, 8>& outStats,
                  int& outWindowSamples,
                  double& outWindowMs) {
        outWindowSamples = std::max(0, validRefFrames);
        // No timing used in fixed-frame mode
        outWindowMs = 0.0;

        for (int i = 0; i < 8; ++i) {
            outStats[i] = computeStatsForHarmonic(i);
        }

        reset();
    }

private:
    // Config
    static constexpr double minRefMagnitude = 0.0;
    static constexpr double minRefConfidence = 0.0;

    // Dynamic per-capture targets (configured on first valid reference frame)
    int targetValidFrames = 8;
    int maxFrames = 16;
    int warmupSkipFrames = 0;

    // State
    bool active = false;
    int selectedPartial = 1; // 1..8
    int displayRegionHarmonicIndex = 0; // 0-based
    int frameCount = 0;
    int validRefFrames = 0;
    double startSec = 0.0;
    double lastNowSec = 0.0;
    double inharmonicityB = 0.0; // predicted B for current note (0 disables)

    std::array<std::vector<double>, 8> ratioSamples{};
    std::array<std::vector<double>, 8> magSamples{};
    std::array<std::vector<double>, 8> confSamples{};

    static double clamp01(double v) { return std::max(0.0, std::min(1.0, v)); }

    static double mean(const std::vector<double>& xs) {
        if (xs.empty()) return 0.0;
        double s = 0.0; for (double v : xs) s += v; return s / static_cast<double>(xs.size());
    }

    static double stdev(const std::vector<double>& xs, double mu) {
        if (xs.size() < 2) return 0.0;
        double s = 0.0; for (double v : xs) { double d = v - mu; s += d * d; }
        return std::sqrt(s / static_cast<double>(xs.size()));
    }

    static double median(std::vector<double> xs) {
        if (xs.empty()) return 0.0;
        const size_t mid = xs.size() / 2;
        std::nth_element(xs.begin(), xs.begin() + mid, xs.end());
        return xs[mid];
    }

    static double psychoScale(double norm) {
        // 0..1 normalized → log10 scaled 0..1 perceptual
        return (norm <= 0.0) ? 0.0 : clamp01(std::log10(norm * 9.0 + 1.0));
    }

    HarmonicStatistics computeStatsForHarmonic(int index) {
        HarmonicStatistics hs{};

        const auto& rs = ratioSamples[index];
        const auto& ms = magSamples[index];
        const auto& cs = confSamples[index];

        if (rs.empty() || ms.empty()) {
            hs.is_valid = false;
            hs.frequency_mean = 0.0; // bound as ratio_mean
            hs.ratio_std = 0.0;
            hs.magnitude_mean = 0.0;
            hs.magnitude_median_scaled = 0.0;
            hs.magnitude_std = 0.0;
            hs.confidence_mean = 0.0;
            hs.sample_count = 0;
            hs.outlier_rate = 0.0;
            return hs;
        }

        // Two-pass outlier handling: compute median-centric 20¢ filter
        std::vector<double> rsCopy = rs;
        const double rMedAll = median(rsCopy);
        std::vector<double> rsKept; rsKept.reserve(rs.size());
        for (double r : rs) {
            const double cents = 1200.0 * std::log2((rMedAll > 0.0) ? (r / rMedAll) : 1.0);
            if (std::abs(cents) <= 20.0) rsKept.push_back(r);
        }
        const double outlierRate = 1.0 - (rs.empty() ? 0.0 : (static_cast<double>(rsKept.size()) / rs.size()));

        // Use median of kept samples (robust)
        double rMedKept = 0.0;
        if (!rsKept.empty()) {
            std::vector<double> rsKeptCopy = rsKept;
            rMedKept = median(rsKeptCopy);
        }
        // Fallback: median of all if none kept
        if (rMedKept <= 0.0) rMedKept = rMedAll;

        const double rMean = mean(rsKept.empty() ? rs : rsKept);
        const double rStd = stdev(rsKept.empty() ? rs : rsKept, rMean);

        const double rawMagMean = mean(ms);
        const double magScaled = psychoScale((rawMagMean <= 0.0) ? 0.0 : rawMagMean);
        const double confMean = mean(cs);

        hs.is_valid = true;
        hs.frequency_mean = rMedKept; // use median for robustness
        hs.ratio_std = rStd;
        hs.magnitude_mean = clamp01((rawMagMean <= 0.0) ? 0.0 : rawMagMean);
        hs.magnitude_median_scaled = magScaled;
        hs.magnitude_std = 0.0; // repurposed elsewhere as SNR
        hs.confidence_mean = clamp01(confMean);
        hs.sample_count = static_cast<int>((rsKept.empty() ? rs : rsKept).size());
        hs.outlier_rate = clamp01(outlierRate);
        return hs;
    }

    void reset() {
        active = false;
        frameCount = 0;
        validRefFrames = 0;
        startSec = 0.0;
        lastNowSec = 0.0;
        for (int i = 0; i < 8; ++i) {
            ratioSamples[i].clear();
            magSamples[i].clear();
            confSamples[i].clear();
        }
    }
};

