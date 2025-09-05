#pragma once

#include <vector>
#include <cstddef>
#include <string>

namespace gui {

struct OctaveLockConfig {
    int capture_period_frames = 40;     // take one sample every N frames
    int max_captures = 10;              // keep last K captures
    float snr_min_linear = 1.5f;        // require peak/mean >= this for both partials (≈ 3.5 dB)
    float strength_balance_min = 0.0f;  // 0 disables balance gate
    float band_low_ratio = 0.75f;       // accept captures with score in [low..high] of running max
    float band_high_ratio = 0.95f;      // drop very top 5%
    float mad_threshold_cents = 0.4f;   // freeze threshold on MAD
    float cents_plausible_abs = 15.0f;  // discard if |2:1 cents| exceeds this
};

class OctaveLockTracker {
public:
    explicit OctaveLockTracker(const OctaveLockConfig& cfg = OctaveLockConfig{}) : cfg_(cfg) {}

    // Push per-frame measurements; only sampled every capture_period_frames
    void push_frame(float f0_hz, float f2_hz,
                    float mag0, float mag2,
                    float snr0_linear, float snr2_linear);

    bool has_estimate() const { return locked_ || !captures_.empty(); }
    bool locked() const { return locked_; }
    float estimate_cents() const { return estimate_cents_; }
    float estimate_mad_cents() const { return mad_cents_; }
    int captures_count() const { return static_cast<int>(captures_.size()); }
    int max_captures() const { return cfg_.max_captures; }
    const OctaveLockConfig& config() const { return cfg_; }
    void set_config(const OctaveLockConfig& c) { cfg_ = c; reset(); }
    int frames_to_next_capture() const { int p = std::max(1, cfg_.capture_period_frames); return p - (frame_counter_ % p); }
    bool last_capture_valid() const { return last_capture_valid_; }
    float last_capture_cents() const { return last_capture_cents_; }
    float last_capture_mag0() const { return last_capture_mag0_; }
    float last_capture_mag2() const { return last_capture_mag2_; }
    float last_capture_snr0() const { return last_capture_snr0_; }
    float last_capture_snr2() const { return last_capture_snr2_; }
    const std::string& last_capture_reason() const { return last_capture_reason_; }

    void reset();

private:
    struct Capture { float cents; float r; float mag0; float mag2; float score; };
    OctaveLockConfig cfg_;
    int frame_counter_ = 0;
    std::vector<Capture> captures_;
    bool locked_ = false;
    float estimate_cents_ = 0.0f;
    float mad_cents_ = 0.0f;
    float running_max_score_ = 0.0f;
    // Last capture diagnostics (updated on each capture attempt)
    bool last_capture_valid_ = false;
    float last_capture_cents_ = 0.0f;
    float last_capture_mag0_ = 0.0f;
    float last_capture_mag2_ = 0.0f;
    float last_capture_snr0_ = 0.0f;
    float last_capture_snr2_ = 0.0f;
    std::string last_capture_reason_;

    static float median(std::vector<float> v);
};

}


