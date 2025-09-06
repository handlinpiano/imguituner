#pragma once

#include <string>
#include <deque>
#include "dsp/analysis/octave_lock_tracker.hpp"

namespace tuner { struct SessionSettings; }

namespace gui {

struct NotesStateReading {
    float f0_hz = 0.0f;
    float f2_hz = 0.0f;
    float f3_hz = 0.0f;
    float f4_hz = 0.0f;
    float f5_hz = 0.0f;
    float f6_hz = 0.0f;
    float mag0 = 0.0f;
    float mag2 = 0.0f;
    float mag3 = 0.0f;
    float mag4 = 0.0f;
    float mag5 = 0.0f;
    float mag6 = 0.0f;
    float snr0 = 0.0f;
    float snr2 = 0.0f;
    float snr3 = 0.0f;
    float snr4 = 0.0f;
    float snr5 = 0.0f;
    float snr6 = 0.0f;
};

class NotesState {
public:
    struct BaselineHarmonicsConfig {
        int lower_end_index = 35;     // indices 0..lower_end_index
        int middle_end_index = 60;    // indices (lower_end_index+1)..middle_end_index
        int lower_initial_max = 8;    // H1..this for low range
        int middle_initial_max = 3;   // H1..this for middle range
        int upper_initial_max = 2;    // H1..this for upper range
        int absolute_max = 8;         // hard cap
    };

    struct ProgressiveEnablementConfig {
        float r2_min = 0.10f;         // mag2/mag1 to unlock H3
        float r_next_scale = 0.06f;   // smaller thresholds for higher lanes
        int kmin_stable = 6;          // captures required for stability
        float mad_stable_cents = 0.4f;// MAD threshold for stability
    };

    void update_from_session(const tuner::SessionSettings& s);
    void set_key_index(int idx); // 0..87
    int key_index() const { return key_index_; }
    void set_preferred_partial_k(int k) { preferred_partial_k_ = k < 1 ? 1 : k; }
    int preferred_partial_k() const { return preferred_partial_k_; }

    void ingest_measurement(const NotesStateReading& r);

    // Note-dependent baseline enabling policy (where to begin):
    // - Indices 0..35  (below A3)      => begin with H1..H8 enabled
    // - Indices 36..60 (A3 through A5) => begin with H1..H3 enabled
    // - Indices 61..87 (A#5 and up)    => begin with H1..H2 enabled
    int initial_max_harmonic_for_note(int note_index) const;
    int initial_max_harmonic_current() const { return initial_max_harmonic_for_note(key_index_); }

    // Absolute cap regardless of note
    int absolute_max_harmonic() const { return baseline_cfg_.absolute_max; }

    // Config accessors
    const BaselineHarmonicsConfig& baseline_config() const { return baseline_cfg_; }
    void set_baseline_config(const BaselineHarmonicsConfig& cfg) { baseline_cfg_ = cfg; }

    const ProgressiveEnablementConfig& progressive_config() const { return progressive_cfg_; }
    void set_progressive_config(const ProgressiveEnablementConfig& cfg) { progressive_cfg_ = cfg; }

    // Harmonic B history (k = 2..8)
    const std::deque<float>& b_history_for_harmonic(int k) const { static std::deque<float> empty; if (k < 1 || k > 8) return empty; return b_hist_[k]; }
    const std::deque<float>& mag_history_for_harmonic(int k) const { static std::deque<float> empty; if (k < 1 || k > 8) return empty; return mag_hist_[k]; }
    float magnitude_weighted_average_b() const;

    // Live (per-frame) measurements for troubleshooting (not gated)
    void set_live_measurements(float f0_hz, float f2_hz, float snr0, float snr2) {
        live_f0_hz_ = f0_hz; live_f2_hz_ = f2_hz; live_snr0_ = snr0; live_snr2_ = snr2; }
    float live_f0_hz() const { return live_f0_hz_; }
    float live_f2_hz() const { return live_f2_hz_; }
    float live_snr0() const { return live_snr0_; }
    float live_snr2() const { return live_snr2_; }

    float center_frequency_hz() const { return center_hz_; }
    const OctaveLockTracker& tracker() const { return tracker_; }
    OctaveLockTracker& tracker() { return tracker_; }

private:
    int key_index_ = 48; // A4
    int preferred_partial_k_ = 1; // center on this partial (e.g., 2 for A3 start)
    float center_hz_ = 440.0f;
    OctaveLockTracker tracker_{};
    struct NoteAnalysis { bool has_b=false; float B=0.0f; float f1_inferred=0.0f; };
    NoteAnalysis per_note_[88]{};

    BaselineHarmonicsConfig baseline_cfg_{};
    ProgressiveEnablementConfig progressive_cfg_{};

    // Per-harmonic histories for B estimates and magnitudes (index by k = 1..8)
    std::deque<float> b_hist_[9];
    std::deque<float> mag_hist_[9];
    int b_hist_max_samples_ = 128;

    // Ultra-light convergence tracker for B (adjacent triplets)
public:
    struct BConvergenceConfig {
        float snr_min = 1.5f;          // gate for harmonics used
        float tau_pair_mad = 0.0005f;  // within-frame MAD threshold across pairwise B
        float tau_time = 0.00015f;     // |B̂ - prev| per frame
        int required_consecutive = 8;  // X frames to lock
        int max_note_index_for_use = 87; // allow all; UI may limit
    };
    void set_b_conv_config(const BConvergenceConfig& c) { bconv_cfg_ = c; bconv_locked_ = false; bconv_ok_count_ = 0; }
    const BConvergenceConfig& b_conv_config() const { return bconv_cfg_; }
    bool b_converged() const { return bconv_locked_; }
    float b_converged_value() const { return bconv_value_; }

private:
    BConvergenceConfig bconv_cfg_{};
    bool bconv_locked_ = false;
    int bconv_ok_count_ = 0;
    float bconv_prev_ = 0.0f;
    float bconv_value_ = 0.0f;

    // Live fields
    float live_f0_hz_ = 0.0f;
    float live_f2_hz_ = 0.0f;
    float live_snr0_ = 0.0f;
    float live_snr2_ = 0.0f;
};

}


