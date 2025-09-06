#include "long_analysis_engine.hpp"

#include <algorithm>
#include <cmath>

using namespace tuner;

namespace gui {

LongAnalysisEngine::LongAnalysisEngine() {}
LongAnalysisEngine::~LongAnalysisEngine() {
    if (worker_.joinable()) worker_.join();
}

void LongAnalysisEngine::configure(int fft_size, int decimation, int num_bins) {
    fft_size_ = std::max(128, fft_size);
    decimation_ = std::max(1, decimation);
    num_bins_ = std::max(16, num_bins);
}

void LongAnalysisEngine::set_center_frequency(float hz) { center_freq_hz_ = hz; }
void LongAnalysisEngine::set_num_segments(int segments) { num_segments_ = std::max(1, std::min(8, segments)); }
void LongAnalysisEngine::set_num_harmonics(int harmonics) { num_harmonics_ = std::max(1, std::min(8, harmonics)); }

void LongAnalysisEngine::start_capture(float durationSec, int sampleRate) {
    if (sampleRate <= 0 || durationSec <= 0.0f) return;
    std::lock_guard<std::mutex> lock(cap_mutex_);
    capture_buffer_.clear();
    capture_sample_rate_ = sampleRate;
    target_samples_ = (int)std::round(durationSec * (float)sampleRate);
    buffer_ready_.store(false);
    capture_active_.store(true);
}

void LongAnalysisEngine::feed_audio(const float* input, int num_samples, int sample_rate) {
    if (!input || num_samples <= 0) return;
    if (!capture_active_.load()) return;
    std::lock_guard<std::mutex> lock(cap_mutex_);
    if (capture_sample_rate_ == 0) capture_sample_rate_ = sample_rate;
    capture_buffer_.insert(capture_buffer_.end(), input, input + num_samples);
    if (target_samples_ > 0 && (int)capture_buffer_.size() >= target_samples_) {
        buffer_to_process_ = capture_buffer_;
        capture_buffer_.clear();
        capture_active_.store(false);
        buffer_ready_.store(true);
    }
}

void LongAnalysisEngine::poll_process() {
    if (!buffer_ready_.load() || processing_.load()) return;
    std::vector<float> copy;
    int sr = 0;
    {
        std::lock_guard<std::mutex> lock(cap_mutex_);
        copy.swap(buffer_to_process_);
        sr = capture_sample_rate_;
        buffer_ready_.store(false);
    }
    if (worker_.joinable()) worker_.join();
    launch_worker(std::move(copy), sr);
}

void LongAnalysisEngine::launch_worker(std::vector<float> buffer_copy, int sample_rate) {
    processing_.store(true);
    worker_ = std::thread(&LongAnalysisEngine::worker_proc, this, std::move(buffer_copy), sample_rate);
}

void LongAnalysisEngine::worker_proc(std::vector<float> buffer, int sample_rate) {
    // Compute one full FFT on captured buffer using FFT utils
    // DC removal and Hann window
    const int N = (int)buffer.size();
    if (N <= 0 || sample_rate <= 0) {
        spectrum_h1_.assign(num_bins_, 0.0f);
        harmonic_mags_.assign(num_harmonics_, 0.0f);
        harmonic_results_.clear();
        B_estimate_ = 0.0f;
        processing_.store(false);
        return;
    }
    // Remove mean to mitigate DC picking
    double mean = 0.0; for (float v : buffer) mean += v; mean /= std::max(1, N);
    std::vector<std::complex<float>> data;
    data.reserve(N);
    const float two_pi = 6.283185307179586f;
    for (int i = 0; i < N; ++i) {
        float w = 0.5f * (1.0f - std::cos(two_pi * (float)i / (float)(N - 1)));
        data.emplace_back(((float)(buffer[i] - (float)mean)) * w, 0.0f);
    }
    // Zero-pad to next power of two
    int M = 1; while (M < N) M <<= 1;
    data.resize(M, std::complex<float>(0.0f, 0.0f));
    tuner::fft::compute_fft_inplace(data);

    // Magnitude spectrum (positive frequencies)
    const int half = M / 2;
    std::vector<float> mags(half, 0.0f);
    for (int k = 0; k < half; ++k) mags[k] = std::abs(data[k]);

    // Bin frequency
    const float df = (float)sample_rate / (float)M;

    // Estimate f1 around known fundamental f0 with quadratic interpolation
    float f0 = center_freq_hz_;
    int k0_guess = std::max(1, (int)std::round(f0 / df));
    int k_search = std::max(1, (int)std::round((f0 * 0.15f) / df)); // ±15% band
    int ks_min = std::max(1, k0_guess - k_search);
    int ks_max = std::min(half - 2, k0_guess + k_search);
    int kmax0 = ks_min; float vmax0 = -1.0f;
    for (int k = ks_min; k <= ks_max; ++k) { if (mags[k] > vmax0) { vmax0 = mags[k]; kmax0 = k; } }
    float delta0 = 0.0f;
    if (kmax0 > 0 && kmax0 + 1 < half) {
        float ml = mags[kmax0 - 1], mc = mags[kmax0], mr = mags[kmax0 + 1];
        float denom = (ml - 2.0f * mc + mr);
        if (std::fabs(denom) > 1e-12f) delta0 = 0.5f * (ml - mr) / denom;
    }
    float f1_est = ((float)kmax0 + delta0) * df;

    // Peak picking around expected harmonic bins
    harmonic_results_.clear();
    harmonic_mags_.assign(num_harmonics_, 0.0f);
    // df already computed above
    // Use f0 for display mapping; f1_est for PFD banding below
    // Use a narrow, cents-based window around each predicted multiple of f0
    const float centsWindow = 35.0f; // ±35 cents gate
    const float nyquist = 0.5f * (float)sample_rate;
    for (int h = 1; h <= num_harmonics_; ++h) {
        float target = f0 * (float)h;
        if (target >= nyquist) { harmonic_mags_[h - 1] = 0.0f; continue; }
        float f_low = target * std::pow(2.0f, -centsWindow / 1200.0f);
        float f_high = target * std::pow(2.0f, centsWindow / 1200.0f);
        int kmin = std::max(1, (int)std::floor(f_low / df));
        int kmax = std::min(half - 2, (int)std::ceil(f_high / df));
        if (kmax <= kmin) { harmonic_mags_[h - 1] = 0.0f; continue; }
        int kpeak = kmin;
        float vmax = -1.0f;
        for (int k = kmin; k <= kmax; ++k) {
            if (mags[k] > vmax) { vmax = mags[k]; kpeak = k; }
        }
        // Quadratic (parabolic) interpolation for sub-bin peak
        float delta = 0.0f;
        if (kpeak > 0 && kpeak + 1 < half) {
            float ml = mags[kpeak - 1];
            float mc = mags[kpeak];
            float mr = mags[kpeak + 1];
            float denom = (ml - 2.0f * mc + mr);
            if (std::fabs(denom) > 1e-12f) delta = 0.5f * (ml - mr) / denom;
            vmax = mc - 0.25f * (ml - mr) * delta; // refined peak mag
        }
        float fpeak = ((float)kpeak + delta) * df;
        float ratio = (f0 > 0.0f) ? (fpeak / f0) : 0.0f;
        float cents = 1200.0f * std::log2((f0 > 0.0f && h > 0) ? (fpeak / (f0 * (float)h)) : 1.0f);
        // Gate outliers strictly outside window (shouldn't happen with kmin/kmax)
        if (std::fabs(cents) > centsWindow * 1.2f) { vmax = 0.0f; }
        harmonic_mags_[h - 1] = std::max(0.0f, vmax);
        harmonic_results_.push_back({h, fpeak, ratio, cents, std::max(0.0f, vmax)});
    }

    // Simple B estimation using least squares on f_n ≈ f0*n*sqrt(1 + B*n^2)
    // Linearize: (f_n/(f0*n))^2 ≈ 1 + B*n^2 => y = 1 + B*x where x = n^2
    // y_i = (f_n/(f0*n))^2
    double Sx = 0.0, Sy = 0.0, Sxx = 0.0, Sxy = 0.0;
    int count = 0;
    for (const auto& hr : harmonic_results_) {
        if (hr.frequency_hz <= 0.0f || f0 <= 0.0f || hr.n <= 0) continue;
        double n = (double)hr.n;
        double x = n * n;
        double y = (hr.frequency_hz / (f0 * n)); y = y * y;
        Sx += x; Sy += y; Sxx += x * x; Sxy += x * y; count++;
    }
    float B = 0.0f;
    if (count >= 2) {
        double denom = (count * Sxx - Sx * Sx);
        if (std::abs(denom) > 1e-9) {
            double slope = (count * Sxy - Sx * Sy) / denom;
            B = (float)std::max(0.0, slope);
        }
    }
    B_estimate_ = B;

    // --- PFD-style refinement (Rauhala et al. 2007) ---
    // Build candidate peaks by subbands of width 5*f1 and take top 10 local maxima per subband
    auto collect_local_maxima = [&](int a, int b){
        std::vector<std::pair<int,float>> loc;
        a = std::max(1, a); b = std::min(half - 2, b);
        for (int k = a + 1; k < b; ++k) {
            if (mags[k] > mags[k - 1] && mags[k] > mags[k + 1]) {
                loc.emplace_back(k, mags[k]);
            }
        }
        std::sort(loc.begin(), loc.end(), [](auto& x, auto& y){ return x.second > y.second; });
        if ((int)loc.size() > 10) loc.resize(10);
        return loc;
    };
    // Subband width 5*f1
    const float subband_hz = std::max(10.0f, 5.0f * f1_est);
    std::vector<int> peak_bins; peak_bins.reserve(200);
    for (float f = df; f < (float)sample_rate * 0.5f; f += subband_hz) {
        int kmin = (int)std::floor(f / df);
        int kmax = (int)std::floor((f + subband_hz) / df);
        auto loc = collect_local_maxima(kmin, kmax);
        for (auto& p : loc) peak_bins.push_back(p.first);
    }
    std::sort(peak_bins.begin(), peak_bins.end());
    peak_bins.erase(std::unique(peak_bins.begin(), peak_bins.end()), peak_bins.end());

    auto find_peak_near = [&](float target_hz, float delta_hz, float& fpk)->bool{
        int k0 = (int)std::round(target_hz / df);
        int rad = std::max(1, (int)std::round(delta_hz / df));
        int kmin = std::max(1, k0 - rad), kmax = std::min(half - 2, k0 + rad);
        int kbest = -1; float vbest = -1.0f;
        for (int k : peak_bins) {
            if (k < kmin) continue; if (k > kmax) break;
            float v = mags[k]; if (v > vbest) { vbest = v; kbest = k; }
        }
        if (kbest < 0) return false;
        float delta = 0.0f;
        float ml = mags[kbest - 1], mc = mags[kbest], mr = mags[kbest + 1];
        float denom = (ml - 2.0f * mc + mr);
        if (std::fabs(denom) > 1e-12f) delta = 0.5f * (ml - mr) / denom;
        fpk = ((float)kbest + delta) * df;
        return true;
    };

    auto compute_Dk = [&](float Bhat, float f1, std::vector<float>& D)->void{
        D.clear();
        const float delta_hz = 0.4f * f1; // ±0.4 f1
        for (int k = 1; k <= 50; ++k) {
            float fkh = (float)k * f1 * std::sqrt(1.0f + Bhat * (float)(k * k));
            if (fkh >= nyquist) break;
            float fpk = 0.0f; if (!find_peak_near(fkh, delta_hz, fpk)) continue;
            D.push_back(fkh - fpk);
        }
    };
    auto trend_sign = [&](const std::vector<float>& D)->int{
        if (D.size() < 2) return 0;
        int pos = 0, neg = 0;
        for (size_t i = 0; i + 1 < D.size(); ++i) { float d = D[i + 1] - D[i]; if (d > 0) pos++; else if (d < 0) neg++; }
        if (pos > neg) return +1; if (neg > pos) return -1; return 0;
    };

    // Iterate B
    float Bhat = std::max(1e-6f, B_estimate_ > 0.0f ? B_estimate_ : 1e-4f);
    float step = 1.0f; // decades
    int last_sign = 0;
    std::vector<float> Dtmp;
    for (int it = 0; it < 40; ++it) {
        compute_Dk(Bhat, f1_est, Dtmp);
        int s = trend_sign(Dtmp);
        if (s == 0) break;
        if (last_sign != 0 && s != last_sign) step *= 0.5f;
        last_sign = s;
        float factor = std::pow(10.0f, (s > 0 ? +step : -step));
        Bhat *= factor;
        Bhat = std::max(0.0f, Bhat);
        if (step < 1e-4f) break;
    }

    // Optional: refine f1 using convexity (mean of first half of Dk)
    float mu = 0.005f; last_sign = 0;
    for (int it = 0; it < 100; ++it) {
        compute_Dk(Bhat, f1_est, Dtmp);
        if (Dtmp.empty()) break;
        size_t halfN = Dtmp.size() / 2; if (halfN == 0) break;
        double avg = 0.0; for (size_t i = 0; i < halfN; ++i) avg += Dtmp[i]; avg /= (double)halfN;
        int s = (avg > 0.0) ? +1 : (avg < 0.0 ? -1 : 0);
        if (s == 0) break;
        if (last_sign != 0 && s != last_sign) mu *= 0.5f;
        last_sign = s;
        f1_est *= (1.0f + (s > 0 ? +mu : -mu));
        if (mu < 1e-5f) break;
    }
    // Re-run B iteration with refined f1
    step = 1.0f; last_sign = 0;
    for (int it = 0; it < 40; ++it) {
        compute_Dk(Bhat, f1_est, Dtmp);
        int s = trend_sign(Dtmp);
        if (s == 0) break;
        if (last_sign != 0 && s != last_sign) step *= 0.5f;
        last_sign = s;
        float factor = std::pow(10.0f, (s > 0 ? +step : -step));
        Bhat *= factor;
        Bhat = std::max(0.0f, Bhat);
        if (step < 1e-4f) break;
    }
    B_estimate_ = Bhat;

    // Refinement pass: re-pick peaks around predicted inharmonic targets using B
    auto pick_peak = [&](float target_hz, float cents_gate, float& out_fpeak, float& out_mag){
        out_fpeak = 0.0f; out_mag = 0.0f;
        if (target_hz <= 0.0f || target_hz >= nyquist) return;
        float f_low = target_hz * std::pow(2.0f, -cents_gate / 1200.0f);
        float f_high = target_hz * std::pow(2.0f, cents_gate / 1200.0f);
        int kmin = std::max(1, (int)std::floor(f_low / df));
        int kmax = std::min(half - 2, (int)std::ceil(f_high / df));
        if (kmax <= kmin) return;
        int kpeak = kmin; float vmax = -1.0f;
        for (int k = kmin; k <= kmax; ++k) { if (mags[k] > vmax) { vmax = mags[k]; kpeak = k; } }
        float delta = 0.0f;
        if (kpeak > 0 && kpeak + 1 < half) {
            float ml = mags[kpeak - 1], mc = mags[kpeak], mr = mags[kpeak + 1];
            float denom = (ml - 2.0f * mc + mr);
            if (std::fabs(denom) > 1e-12f) delta = 0.5f * (ml - mr) / denom;
            vmax = mc - 0.25f * (ml - mr) * delta;
        }
        out_fpeak = ((float)kpeak + delta) * df;
        out_mag = std::max(0.0f, vmax);
    };

    std::vector<HarmonicResult> refined_results;
    refined_results.reserve(num_harmonics_);
    std::vector<float> refined_mags(num_harmonics_, 0.0f);
    const float refineGateCents = 20.0f; // tighter gate now that we have B
    float maxMag = 0.0f; for (float m : harmonic_mags_) if (m > maxMag) maxMag = m;
    for (int h = 1; h <= num_harmonics_; ++h) {
        double n = (double)h;
        float predicted = f0 * (float)h * std::sqrt(1.0f + B_estimate_ * (float)(h * h));
        float fpk = 0.0f, mag = 0.0f;
        pick_peak(predicted, refineGateCents, fpk, mag);
        // Magnitude gate relative to overall levels to reject spurious tiny peaks
        if (maxMag > 0.0f && mag < 0.02f * maxMag) { mag = 0.0f; fpk = predicted; }
        refined_mags[h - 1] = mag;
        refined_results.push_back({h, fpk, 0.0f, 0.0f, mag});
    }

    // Weighted B recompute using refined results
    double W = 0.0, mx = 0.0, my = 0.0; // for weighted means
    for (const auto& hr : refined_results) {
        if (hr.frequency_hz <= 0.0f || f0 <= 0.0f || hr.n <= 0) continue;
        double w = std::max(0.0f, hr.magnitude);
        double n = (double)hr.n;
        double x = n * n;
        double y = (hr.frequency_hz / (f0 * n)); y = y * y;
        W += w; mx += w * x; my += w * y;
    }
    float Bref = B_estimate_;
    if (W > 0.0) {
        mx /= W; my /= W;
        double num = 0.0, den = 0.0;
        for (const auto& hr : refined_results) {
            if (hr.frequency_hz <= 0.0f || f0 <= 0.0f || hr.n <= 0) continue;
            double w = std::max(0.0f, hr.magnitude);
            double n = (double)hr.n;
            double x = n * n;
            double y = (hr.frequency_hz / (f0 * n)); y = y * y;
            num += w * (x - mx) * (y - my);
            den += w * (x - mx) * (x - mx);
        }
        if (den > 1e-12) {
            double slope = num / den;
            Bref = (float)std::max(0.0, slope);
        }
    }

    B_estimate_ = Bref;
    // Normalize results using H1 as reference so H1 is always 1.0 and 0 cents
    float ref_f1 = (refined_results.empty() ? f1_est : refined_results.front().frequency_hz);
    if (ref_f1 <= 0.0f) ref_f1 = f1_est;
    for (auto& hr : refined_results) {
        float r = (ref_f1 > 0.0f) ? (hr.frequency_hz / ref_f1) : 0.0f;
        hr.ratio = (hr.n == 1 ? 1.0f : r);
        float cents = 0.0f;
        if (hr.n == 1) cents = 0.0f;
        else if (r > 0.0f) cents = 1200.0f * std::log2(r / (float)hr.n);
        hr.cents = cents;
    }
    harmonic_results_.swap(refined_results);
    harmonic_mags_.swap(refined_mags);

    // Downsample display spectrum around fundamental using bins mapping similar to ZoomFFT
    spectrum_h1_.assign(num_bins_, 0.0f);
    const float centsMin = -120.0f, centsSpan = 240.0f;
    for (int b = 0; b < num_bins_; ++b) {
        float cents = centsMin + centsSpan * ((float)b / (float)(num_bins_ - 1));
        float targetHz = f0 * std::pow(2.0f, cents / 1200.0f);
        float kf = targetHz / df;
        int k0i = (int)std::floor(kf);
        float frac = kf - (float)k0i;
        if (k0i >= 0 && k0i + 1 < half) {
            float v0 = mags[k0i];
            float v1 = mags[k0i + 1];
            spectrum_h1_[b] = v0 * (1.0f - frac) + v1 * frac;
        }
    }
    processing_.store(false);
}

} // namespace gui


