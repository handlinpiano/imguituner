#include "pages/notes_state.hpp"
#include "tuner/session_settings.hpp"
#include <cmath>

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
    float f2 = r.f2_hz, f3 = r.f3_hz, f4 = r.f4_hz;
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
    if (ok) {
        // Infer f1 from the most reliable available partial
        int m=0; float fm=0.0f; if (have(f2)) { m=2; fm=f2; } else if (have(f3)) { m=3; fm=f3; } else if (have(f4)) { m=4; fm=f4; }
        if (m>0) {
            float f1 = fm / (m*std::sqrt(1.0f + B_est*m*m));
            int idx = key_index_;
            per_note_[idx].has_b = true; per_note_[idx].B = B_est; per_note_[idx].f1_inferred = f1;
        }
    }
}

}


