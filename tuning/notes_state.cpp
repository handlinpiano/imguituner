#include "notes_state.hpp"
#include "tuner/session_settings.hpp"
#include <cmath>
#include <array>
#include <algorithm>
#include <vector>

namespace gui {

void NotesState::update_from_session(const tuner::SessionSettings& s) {
    float a4_hz = 440.0f * std::pow(2.0f, s.a4_offset_cents / 1200.0f);
    int n = key_index_ - 48;
    float f1 = a4_hz * std::pow(2.0f, n / 12.0f);
    // Center on preferred partial (e.g., k=2 for starting on A3 2nd partial)
    center_hz_ = f1 * std::max(1, preferred_partial_k_);
}

void NotesState::set_key_index(int idx) {
    if (idx < 0) idx = 0; if (idx > 87) idx = 87;
    key_index_ = idx;
}

void NotesState::ingest_measurement(const NotesStateReading& r) {
    tracker_.push_frame(r.f0_hz, r.f2_hz, r.mag0, r.mag2, r.snr0, r.snr2);
    // Lightweight B inference from higher partials if f0 is weak
    // Use pairs among {f2,f3,f4} when available to estimate B, then back out f1.
    auto have = [&](float x){ return x > 0.0f && std::isfinite(x); };
    float f2 = r.f2_hz, f3 = r.f3_hz, f4 = r.f4_hz, f5 = r.f5_hz, f6 = r.f6_hz;
    float B_est = 0.0f; bool ok=false;
    auto solve_B = [&](int m, float fm, int k, float fk)->std::pair<bool,float>{
        // Solve fk/(m*fm) = (k/m)*sqrt((1+Bk^2)/(1+Bm^2)) for B with a few iterations
        if (!(fm>0 && fk>0)) return {false,0.0f};
        float lhs = fk/(m*fm); if (!(lhs>0)) return {false,0.0f};
        float Bmin=1e-6f, Bmax=6e-3f; // conservative piano bounds
        for (int it=0; it<12; ++it) {
            float Bmid = 0.5f*(Bmin+Bmax);
            float num = 1.0f + Bmid*k*k;
            float den = 1.0f + Bmid*m*m;
            float rhs = (k/(float)m)*std::sqrt(num/den);
            if (rhs < lhs) Bmin = Bmid; else Bmax = Bmid;
        }
        float B = 0.5f*(Bmin+Bmax);
        return {true,B};
    };
    if (!ok && have(f2) && have(f3)) { auto s=solve_B(2,f2,3,f3); ok=s.first; B_est=s.second; }
    if (!ok && have(f2) && have(f4)) { auto s=solve_B(2,f2,4,f4); ok=s.first; B_est=s.second; }
    if (!ok && have(f3) && have(f4)) { auto s=solve_B(3,f3,4,f4); ok=s.first; B_est=s.second; }
    if (!ok && have(f3) && have(f5)) { auto s=solve_B(3,f3,5,f5); ok=s.first; B_est=s.second; }
    if (!ok && have(f4) && have(f6)) { auto s=solve_B(4,f4,6,f6); ok=s.first; B_est=s.second; }
    if (ok) {
        // Infer f1 from the most reliable available partial
        int m=0; float fm=0.0f; if (have(f2)) { m=2; fm=f2; } else if (have(f3)) { m=3; fm=f3; } else if (have(f4)) { m=4; fm=f4; }
        if (m>0) {
            float f1 = fm / (m*std::sqrt(1.0f + B_est*m*m));
            int idx = key_index_;
            per_note_[idx].has_b = true; per_note_[idx].B = B_est; per_note_[idx].f1_inferred = f1;
        }
    }

    // Record per-harmonic B estimates where possible using f1 and fk pairs
    auto push_hist = [&](int k, float B, float mag){
        if (k < 1 || k > 8) return;
        if (!(B > 0.0f) || !std::isfinite(B)) return;
        auto& qB = b_hist_[k];
        auto& qM = mag_hist_[k];
        qB.push_back(B);
        qM.push_back(std::max(0.0f, mag));
        while ((int)qB.size() > b_hist_max_samples_) { qB.pop_front(); }
        while ((int)qM.size() > b_hist_max_samples_) { qM.pop_front(); }
    };

    // If we have an f1 estimate, compute B_k from fk vs f1 for k=2..4
    float f1_use = r.f0_hz;
    if (!(f1_use > 0.0f) && per_note_[key_index_].has_b && per_note_[key_index_].f1_inferred > 0.0f) {
        f1_use = per_note_[key_index_].f1_inferred;
    }
    auto solve_B_from_f1_fk = [&](int k, float fk)->std::pair<bool,float>{
        if (!(f1_use>0.0f && fk>0.0f)) return std::make_pair(false,0.0f);
        float lhs = fk / (k * f1_use);
        if (!(lhs>0)) return std::make_pair(false,0.0f);
        float Bmin=1e-6f, Bmax=6e-3f;
        for (int it=0; it<12; ++it) {
            float Bmid = 0.5f*(Bmin+Bmax);
            float rhs = std::sqrt(1.0f + Bmid*k*k);
            if (rhs < lhs) Bmin = Bmid; else Bmax = Bmid;
        }
        float B = 0.5f*(Bmin+Bmax);
        return std::make_pair(true,B);
    };
    if (f1_use > 0.0f) {
        if (have(f2)) { auto s = solve_B_from_f1_fk(2, f2); if (s.first) push_hist(2, s.second, r.mag2); }
        if (have(f3)) { auto s = solve_B_from_f1_fk(3, f3); if (s.first) push_hist(3, s.second, r.mag3); }
        if (have(f4)) { auto s = solve_B_from_f1_fk(4, f4); if (s.first) push_hist(4, s.second, r.mag4); }
        if (have(f5)) { auto s = solve_B_from_f1_fk(5, f5); if (s.first) push_hist(5, s.second, r.mag5); }
        if (have(f6)) { auto s = solve_B_from_f1_fk(6, f6); if (s.first) push_hist(6, s.second, r.mag6); }
    }

    // Convergence tracker using adjacent triplets
    auto snr_ok = [&](float s){ return std::isfinite(s) && s >= bconv_cfg_.snr_min; };
    struct Pair { int a,b; float Ba; };
    auto pairB = [&](int a, float fa, int b, float fb)->std::pair<bool,float>{
        auto s = solve_B(a, fa, b, fb);
        return {s.first, s.second};
    };
    std::vector<float> candidates; candidates.reserve(3);
    auto consider_triplet = [&](int a, float fa, float sa,
                                int b, float fb, float sb,
                                int c, float fc, float sc){
        if (!(have(fa)&&have(fb)&&have(fc))) return;
        if (!(snr_ok(sa)&&snr_ok(sb)&&snr_ok(sc))) return;
        auto p1 = pairB(a,fa,b,fb);
        auto p2 = pairB(a,fa,c,fc);
        auto p3 = pairB(b,fb,c,fc);
        if (!(p1.first&&p2.first&&p3.first)) return;
        float v1=p1.second, v2=p2.second, v3=p3.second;
        std::array<float,3> vs{v1,v2,v3};
        std::sort(vs.begin(), vs.end());
        float med = vs[1];
        float d1 = std::fabs(vs[0]-med), d2=std::fabs(vs[1]-med), d3=std::fabs(vs[2]-med);
        std::array<float,3> dev{d1,d2,d3}; std::sort(dev.begin(), dev.end());
        float mad = dev[1];
        // Note-based sanity bounds
        int ni = key_index_;
        float Bmin = 1e-6f;
        float t = std::max(0.0f, std::min(1.0f, ni/87.0f));
        float Bmax = std::min(0.006f, 0.0005f + 0.005f * t * t);
        if (med < Bmin || med > Bmax) return;
        // Keep best (smallest MAD)
        if (mad <= bconv_cfg_.tau_pair_mad) {
            candidates.push_back(med);
        }
    };
    consider_triplet(1, r.f0_hz, r.snr0, 2, r.f2_hz, r.snr2, 3, r.f3_hz, r.snr3);
    consider_triplet(2, r.f2_hz, r.snr2, 3, r.f3_hz, r.snr3, 4, r.f4_hz, r.snr4);
    consider_triplet(3, r.f3_hz, r.snr3, 4, r.f4_hz, r.snr4, 5, r.f5_hz, r.snr5);
    consider_triplet(4, r.f4_hz, r.snr4, 5, r.f5_hz, r.snr5, 6, r.f6_hz, r.snr6);
    if (!candidates.empty()) {
        std::sort(candidates.begin(), candidates.end());
        float med = candidates[candidates.size()/2];
        if (bconv_ok_count_ == 0) {
            bconv_prev_ = med;
            bconv_ok_count_ = 1;
        } else {
            if (std::fabs(med - bconv_prev_) <= bconv_cfg_.tau_time) {
                bconv_ok_count_++;
            } else {
                bconv_ok_count_ = 1;
            }
            bconv_prev_ = med;
        }
        if (bconv_ok_count_ >= bconv_cfg_.required_consecutive) {
            bconv_locked_ = true;
            bconv_value_ = med;
        }
    } else {
        // No candidate this frame resets streak but keeps last lock
        bconv_ok_count_ = 0;
    }

}

float NotesState::magnitude_weighted_average_b() const {
    double num = 0.0;
    double den = 0.0;
    for (int k = 1; k <= 8; ++k) {
        const auto& bq = b_hist_[k];
        const auto& mq = mag_hist_[k];
        if (bq.empty() || mq.empty()) continue;
        // Use latest sample for each k for a simple real-time average
        float B = bq.back();
        float M = mq.back();
        if (std::isfinite(B) && B > 0.0f && std::isfinite(M) && M > 0.0f) {
            num += (double)B * (double)M;
            den += (double)M;
        }
    }
    if (den <= 0.0) return 0.0f;
    return (float)(num / den);
}

int NotesState::initial_max_harmonic_for_note(int note_index) const {
    if (note_index < 0) note_index = 0;
    if (note_index > 87) note_index = 87;
    if (note_index <= baseline_cfg_.lower_end_index) {
        return std::min(baseline_cfg_.lower_initial_max, baseline_cfg_.absolute_max);
    } else if (note_index <= baseline_cfg_.middle_end_index) {
        return std::min(baseline_cfg_.middle_initial_max, baseline_cfg_.absolute_max);
    } else {
        return std::min(baseline_cfg_.upper_initial_max, baseline_cfg_.absolute_max);
    }
}

}


