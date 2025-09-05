#include "analysis/octave_lock_tracker.hpp"
#include <algorithm>
#include <cmath>

namespace gui {

static inline bool finite_pos(float x) { return std::isfinite(x) && x > 0.0f; }

float OctaveLockTracker::median(std::vector<float> v) {
    if (v.empty()) return 0.0f;
    std::sort(v.begin(), v.end());
    size_t n = v.size();
    if (n % 2 == 1) return v[n/2];
    return 0.5f * (v[n/2 - 1] + v[n/2]);
}

void OctaveLockTracker::reset() {
    frame_counter_ = 0;
    captures_.clear();
    locked_ = false;
    estimate_cents_ = 0.0f;
    mad_cents_ = 0.0f;
    last_capture_valid_ = false;
    last_capture_cents_ = 0.0f;
    last_capture_mag0_ = last_capture_mag2_ = 0.0f;
    last_capture_snr0_ = last_capture_snr2_ = 0.0f;
    last_capture_reason_.clear();
    running_max_score_ = 0.0f;
}

void OctaveLockTracker::push_frame(float f0_hz, float f2_hz,
                                   float mag0, float mag2,
                                   float snr0, float snr2) {
    if (locked_) return;
    if (++frame_counter_ % std::max(1, cfg_.capture_period_frames) != 0) return;
    last_capture_valid_ = false;

    // Basic gating
    if (!finite_pos(f0_hz) || !finite_pos(f2_hz)) { last_capture_reason_ = "invalid freq"; return; }
    if (!finite_pos(mag0) || !finite_pos(mag2)) { last_capture_reason_ = "invalid mag"; return; }
    if (!finite_pos(snr0) || !finite_pos(snr2)) { last_capture_reason_ = "invalid snr"; return; }
    if (snr0 < cfg_.snr_min_linear || snr2 < cfg_.snr_min_linear) { last_capture_reason_ = "snr too low"; return; }
    float mn = std::min(mag0, mag2), mx = std::max(mag0, mag2);
    if (mn < cfg_.strength_balance_min * mx) { last_capture_reason_ = "unbalanced"; return; }

    float r = f2_hz / (2.0f * f0_hz);
    if (!(r > 0.0f) || !std::isfinite(r)) { last_capture_reason_ = "bad ratio"; return; }
    float cents = 1200.0f * std::log2(r);
    if (std::fabs(cents) > cfg_.cents_plausible_abs) { last_capture_reason_ = "implausible"; return; }

    float score = mn * mn; // robust simpler score; track running max
    if (score > running_max_score_) running_max_score_ = score;
    // Simple band-pass on strength relative to running max
    if (running_max_score_ > 0.0f) {
        float r = score / running_max_score_;
        if (r < cfg_.band_low_ratio) { last_capture_reason_ = "too weak"; return; }
        if (r > cfg_.band_high_ratio) { last_capture_reason_ = "too strong"; return; }
    }
    captures_.push_back(Capture{cents, r, mag0, mag2, score});
    if ((int)captures_.size() > cfg_.max_captures) captures_.erase(captures_.begin());

    last_capture_valid_ = true;
    last_capture_cents_ = cents;
    last_capture_mag0_ = mag0;
    last_capture_mag2_ = mag2;
    last_capture_snr0_ = snr0;
    last_capture_snr2_ = snr2;
    last_capture_reason_.clear();

    // Select top 20% by score
    std::vector<Capture> sorted = captures_;
    std::sort(sorted.begin(), sorted.end(), [](const Capture& a, const Capture& b){ return a.score > b.score; });
    int take = std::max(1, (int)std::ceil(sorted.size() * 0.2f));
    std::vector<float> cents_sel; cents_sel.reserve(take);
    for (int i = 0; i < take; ++i) cents_sel.push_back(sorted[i].cents);

    float med = median(cents_sel);
    std::vector<float> abs_dev; abs_dev.reserve(cents_sel.size());
    for (float c : cents_sel) abs_dev.push_back(std::fabs(c - med));
    float mad = median(abs_dev) * 1.4826f;

    estimate_cents_ = med;
    mad_cents_ = mad;
    if (mad <= cfg_.mad_threshold_cents && (int)cents_sel.size() >= 3) {
        locked_ = true;
    }
}

}


