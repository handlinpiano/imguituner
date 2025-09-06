#include "zoom_processor.hpp"

#include <algorithm>
#include <cmath>

namespace tuner::dsp {

ZoomProcessor::ZoomProcessor() {
    cfg_.decimation = 16;
    cfg_.fft_size = 16384;
    cfg_.num_bins = 1200;
    cfg_.sample_rate = sample_rate_;
    cfg_.use_hann = true;
    zoomfft_ = std::make_unique<tuner::ZoomFFT>(cfg_);
    zoomfft_f0_ = std::make_unique<tuner::ZoomFFT>(cfg_);
}

void ZoomProcessor::configure(int sample_rate, int fft_size, int decimation, int num_bins) {
    std::lock_guard<std::mutex> lock(mutex_);
    sample_rate_ = sample_rate;
    cfg_.sample_rate = sample_rate_;
    cfg_.fft_size = fft_size;
    cfg_.decimation = decimation;
    cfg_.num_bins = num_bins;
    zoomfft_ = std::make_unique<tuner::ZoomFFT>(cfg_);
    zoomfft_f0_ = std::make_unique<tuner::ZoomFFT>(cfg_);
}

void ZoomProcessor::set_center_frequency(float hz) {
    std::lock_guard<std::mutex> lock(mutex_);
    center_frequency_hz_ = hz > 0.0f && std::isfinite(hz) ? hz : 440.0f;
}

void ZoomProcessor::set_window_seconds(float seconds) {
    std::lock_guard<std::mutex> lock(mutex_);
    window_seconds_ = std::clamp(seconds, 0.05f, 1.0f);
}

void ZoomProcessor::push_samples(const float* input, int count) {
    if (!input || count <= 0) return;
    std::lock_guard<std::mutex> lock(mutex_);
    for (int i = 0; i < count; ++i) ring_.push_back(input[i]);
    const int max_samples = static_cast<int>(sample_rate_ * window_seconds_);
    while (static_cast<int>(ring_.size()) > max_samples) ring_.pop_front();
}

bool ZoomProcessor::try_get_snapshot(DspSnapshot& out) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (ring_.empty()) return false;

    // Use the decimated window length as the cap, but ensure minimum samples for stability
    const int cap_time = static_cast<int>(sample_rate_ * window_seconds_);
    const int cap_fft  = cfg_.fft_size * std::max(1, cfg_.decimation);
    const int required = std::min(cap_time, cap_fft);
    const int take = std::min(required, static_cast<int>(ring_.size()));
    if (take <= std::max(64, cfg_.decimation * 4)) return false;

    std::vector<float> proc;
    proc.reserve(take);
    auto it = ring_.end();
    for (int i = 0; i < take; ++i) { --it; proc.push_back(*it); }
    std::reverse(proc.begin(), proc.end());

    // Main region (around center)
    auto cfg_copy = cfg_;
    bool aux_flag = aux_enabled_;
    auto mags = zoomfft_->process(proc.data(), (int)proc.size(), center_frequency_hz_);

    // compute peak
    float max_mag = 0.0f; int peak_bin = 0;
    for (int i = 0; i < (int)mags.size(); ++i) if (mags[i] > max_mag) { max_mag = mags[i]; peak_bin = i; }
    const float cents = -120.0f + 240.0f * (static_cast<float>(peak_bin) / (std::max(1, cfg_.num_bins) - 1));
    const float peak_hz = center_frequency_hz_ * std::pow(2.0f, cents / 1200.0f);

    // RMS from the most recent chunk (rough estimate)
    double acc = 0.0; for (float v : proc) acc += (double)v * (double)v;
    const float rms = take > 0 ? std::sqrt(acc / (double)take) : 0.0f;

    // Estimate SNR around center (f2) using peak/median in a limited window (~±40 cents)
    float f2_hz = peak_hz; float mag2 = max_mag; float snr2 = 0.0f;
    if (!mags.empty()) {
        int n = (int)mags.size();
        int center_bin = (n - 1) / 2;
        int half_range = std::max(1, (int)std::round(40.0f * (n - 1) / 240.0f));
        int i0 = std::max(0, center_bin - half_range);
        int i1 = std::min(n - 1, center_bin + half_range);
        float local_max = 0.0f; int peak_local = center_bin;
        for (int i = i0; i <= i1; ++i) if (mags[i] > local_max) { local_max = mags[i]; peak_local = i; }
        float cents_local = -120.0f + 240.0f * (static_cast<float>(peak_local) / (n - 1));
        f2_hz = center_frequency_hz_ * std::pow(2.0f, cents_local / 1200.0f);
        std::vector<float> tmp = mags; std::nth_element(tmp.begin(), tmp.begin()+tmp.size()/2, tmp.end());
        double median = tmp[tmp.size()/2]; if (median <= 1e-9) median = 1e-9;
        snr2 = local_max / (float)median; mag2 = local_max;
    }

    // Secondary region (around center/2) for f0 tracking
    float f0_center = center_frequency_hz_ * 0.5f;
    auto mags_f0 = zoomfft_f0_->process(proc.data(), (int)proc.size(), f0_center);
    float f0_hz = 0.0f; float mag0 = 0.0f; float snr0 = 0.0f;
    if (!mags_f0.empty()) {
        int n0 = (int)mags_f0.size();
        int center_bin0 = (n0 - 1) / 2;
        int half_range0 = std::max(1, (int)std::round(40.0f * (n0 - 1) / 240.0f));
        int j0 = std::max(0, center_bin0 - half_range0);
        int j1 = std::min(n0 - 1, center_bin0 + half_range0);
        float local_max0 = 0.0f; int peak_local0 = center_bin0;
        for (int j = j0; j <= j1; ++j) if (mags_f0[j] > local_max0) { local_max0 = mags_f0[j]; peak_local0 = j; }
        float cents_local0 = -120.0f + 240.0f * (static_cast<float>(peak_local0) / (n0 - 1));
        f0_hz = f0_center * std::pow(2.0f, cents_local0 / 1200.0f);
        std::vector<float> tmp0 = mags_f0; std::nth_element(tmp0.begin(), tmp0.begin()+tmp0.size()/2, tmp0.end());
        double median0 = tmp0[tmp0.size()/2]; if (median0 <= 1e-9) median0 = 1e-9;
        snr0 = local_max0 / (float)median0; mag0 = local_max0;
    }

    // Optional H3/H4 evaluation windows when we have f0 estimate
    float f3_hz = 0.0f, f4_hz = 0.0f, f5_hz = 0.0f, f6_hz = 0.0f;
    float mag3 = 0.0f, mag4 = 0.0f, mag5 = 0.0f, mag6 = 0.0f;
    float snr3 = 0.0f, snr4 = 0.0f, snr5 = 0.0f, snr6 = 0.0f;
    // Release lock before auxiliary scans to avoid blocking audio thread
    lock.unlock();
    if (aux_flag && f0_hz > 0.0f) {
        auto compute_peak_in_window = [&](float target_hz){
            // Use a fresh ZoomFFT instance to avoid any cross-talk with the main spectrum state
            tuner::ZoomFFT temp(cfg_copy);
            auto mm = temp.process(proc.data(), (int)proc.size(), target_hz);
            if (mm.empty()) return std::tuple<float,float,float>(0.0f,0.0f,0.0f);
            int n = (int)mm.size();
            int center_bin = (n - 1) / 2;
            int half_range = std::max(1, (int)std::round(40.0f * (n - 1) / 240.0f));
            int i0 = std::max(0, center_bin - half_range);
            int i1 = std::min(n - 1, center_bin + half_range);
            float local_max = 0.0f; int peak_local = center_bin;
            for (int i = i0; i <= i1; ++i) if (mm[i] > local_max) { local_max = mm[i]; peak_local = i; }
            float cents_local = -120.0f + 240.0f * (static_cast<float>(peak_local) / (n - 1));
            float hz = target_hz * std::pow(2.0f, cents_local / 1200.0f);
            std::vector<float> tmp = mm; std::nth_element(tmp.begin(), tmp.begin()+tmp.size()/2, tmp.end());
            double median = tmp[tmp.size()/2]; if (median <= 1e-9) median = 1e-9;
            float snr = local_max / (float)median;
            return std::tuple<float,float,float>(hz, local_max, snr);
        };
        std::tie(f3_hz, mag3, snr3) = compute_peak_in_window(f0_hz * 3.0f);
        std::tie(f4_hz, mag4, snr4) = compute_peak_in_window(f0_hz * 4.0f);
        std::tie(f5_hz, mag5, snr5) = compute_peak_in_window(f0_hz * 5.0f);
        std::tie(f6_hz, mag6, snr6) = compute_peak_in_window(f0_hz * 6.0f);
    }

    out.magnitudes = std::move(mags);
    out.peak_hz = peak_hz;
    out.peak_magnitude = max_mag;
    out.rms = rms;
    out.f0_hz = f0_hz;
    out.f2_hz = f2_hz;
    out.f3_hz = f3_hz;
    out.f4_hz = f4_hz;
    out.f5_hz = f5_hz;
    out.f6_hz = f6_hz;
    out.mag0 = mag0;
    out.mag2 = mag2;
    out.mag3 = mag3;
    out.mag4 = mag4;
    out.mag5 = mag5;
    out.mag6 = mag6;
    out.snr0 = snr0;
    out.snr2 = snr2;
    out.snr3 = snr3;
    out.snr4 = snr4;
    out.snr5 = snr5;
    out.snr6 = snr6;
    out.center_frequency_hz = center_frequency_hz_;
    out.valid = true;
    return true;
}

} // namespace tuner::dsp


