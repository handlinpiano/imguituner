#pragma once

#include <vector>
#include <deque>
#include <memory>
#include <mutex>

#include "zoom_fft.hpp"

namespace tuner::dsp {

struct DspSnapshot {
    std::vector<float> magnitudes;
    float peak_hz = 0.0f;
    float peak_magnitude = 0.0f;
    float rms = 0.0f;
    // Dual-region tracking for inharmonicity/partials
    float f0_hz = 0.0f;   // around center/2
    float f2_hz = 0.0f;   // around center
    float f3_hz = 0.0f;   // around 3*f0
    float f4_hz = 0.0f;   // around 4*f0
    float f5_hz = 0.0f;   // around 5*f0
    float f6_hz = 0.0f;   // around 6*f0
    float mag0 = 0.0f;
    float mag2 = 0.0f;
    float mag3 = 0.0f;
    float mag4 = 0.0f;
    float mag5 = 0.0f;
    float mag6 = 0.0f;
    float snr0 = 0.0f;    // peak/median around f0 window
    float snr2 = 0.0f;    // peak/median around f2 window
    float snr3 = 0.0f;
    float snr4 = 0.0f;
    float snr5 = 0.0f;
    float snr6 = 0.0f;
    float center_frequency_hz = 440.0f;
    bool valid = false;
};

class ZoomProcessor {
public:
    ZoomProcessor();

    void configure(int sample_rate, int fft_size, int decimation, int num_bins = 1200);
    void set_center_frequency(float hz);
    void set_window_seconds(float seconds);
    void set_aux_harmonics_enabled(bool enabled) { aux_enabled_ = enabled; }

    // Real-time thread safe: minimal locking
    void push_samples(const float* input, int count);

    // GUI thread: tries to compute and return a fresh snapshot
    bool try_get_snapshot(DspSnapshot& out);

private:
    std::mutex mutex_;
    std::deque<float> ring_;
    int sample_rate_ = 48000;
    float window_seconds_ = 0.35f;
    tuner::ZoomFFTConfig cfg_{};
    std::unique_ptr<tuner::ZoomFFT> zoomfft_;
    std::unique_ptr<tuner::ZoomFFT> zoomfft_f0_;
    float center_frequency_hz_ = 440.0f;
    bool aux_enabled_ = false;
};

} // namespace tuner::dsp


