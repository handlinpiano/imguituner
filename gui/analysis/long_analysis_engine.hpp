#pragma once

#include <vector>
#include <atomic>
#include <thread>
#include <mutex>
#include <memory>
#include "fft/fft_utils.hpp"

namespace gui {

// LongAnalysisEngine captures a few seconds of audio and performs high-resolution
// analysis using multiple ZoomFFT instances centered at the fundamental and its
// harmonics. Results include a detailed spectrum for H1 and bar magnitudes for
// the first N harmonics (1..8).
class LongAnalysisEngine {
public:
    LongAnalysisEngine();
    ~LongAnalysisEngine();

    void configure(int fft_size, int decimation, int num_bins);
    void set_center_frequency(float hz);
    void set_num_segments(int segments);       // time averaging 1..8
    void set_num_harmonics(int harmonics);     // 1..8

    // Begin capture for durationSec at given sampleRate.
    void start_capture(float durationSec, int sampleRate);

    // Feed audio from realtime callback. Safe to call frequently.
    void feed_audio(const float* input, int num_samples, int sample_rate);

    // Call periodically from the audio or UI thread to kick off processing when ready.
    void poll_process();

    // Results
    const std::vector<float>& spectrum() const { return spectrum_h1_; }
    const std::vector<float>& harmonic_magnitudes() const { return harmonic_mags_; }

    struct HarmonicResult {
        int n = 0;
        float frequency_hz = 0.0f;
        float ratio = 0.0f;    // f_n / f0
        float cents = 0.0f;    // 1200*log2(f_n/(n*f0))
        float magnitude = 0.0f;
    };
    const std::vector<HarmonicResult>& harmonic_results() const { return harmonic_results_; }
    float inharmonicity_B() const { return B_estimate_; }

    bool is_capturing() const { return capture_active_.load(); }
    bool is_processing() const { return processing_.load(); }

private:
    void launch_worker(std::vector<float> buffer_copy, int sample_rate);
    void worker_proc(std::vector<float> buffer, int sample_rate);

    // Config
    int fft_size_ = 16384;
    int decimation_ = 16;
    int num_bins_ = 1200;
    float center_freq_hz_ = 440.0f;
    int num_segments_ = 4;      // time segments for averaging (1..8)
    int num_harmonics_ = 8;     // harmonics to analyze (1..8)

    // Capture state
    std::atomic<bool> capture_active_{false};
    int target_samples_ = 0;
    int capture_sample_rate_ = 0;
    std::vector<float> capture_buffer_;
    std::mutex cap_mutex_;
    std::atomic<bool> buffer_ready_{false};
    std::vector<float> buffer_to_process_;

    // Processing
    std::atomic<bool> processing_{false};
    std::thread worker_;

    // Outputs
    std::vector<float> spectrum_h1_;
    std::vector<float> harmonic_mags_;
    std::vector<HarmonicResult> harmonic_results_;
    float B_estimate_ = 0.0f;
};

} // namespace gui


