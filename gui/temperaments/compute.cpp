#include "temperaments/compute.hpp"
#include <cmath>

namespace gui { namespace temperaments {

static inline float et_freq_from_midi(int midi, float a4_hz) {
    return a4_hz * std::pow(2.0f, (static_cast<float>(midi) - 69.0f) / 12.0f);
}

BeatRates compute_signed_beats_from_cents(const std::vector<float>& note_cents, float a4_hz) {
    BeatRates out;
    out.fifths_hz.resize(12);
    out.maj3_hz.resize(12);
    out.min3_hz.resize(12);

    // C4..B4 (MIDI 60..71)
    float base[12];
    for (int i = 0; i < 12; ++i) base[i] = et_freq_from_midi(60 + i, a4_hz);

    float freqs[12];
    for (int i = 0; i < 12; ++i) {
        float c = (i < static_cast<int>(note_cents.size())) ? note_cents[i] : 0.0f;
        freqs[i] = base[i] * std::pow(2.0f, c / 1200.0f);
    }

    auto upper = [&](int i, int steps) -> float {
        int j = i + steps;
        if (j < 12) return freqs[j];
        return freqs[j - 12] * 2.0f;
    };

    for (int i = 0; i < 12; ++i) {
        float L = freqs[i];
        float U5 = upper(i, 7);
        float U4 = upper(i, 4);
        float U3 = upper(i, 3);
        out.fifths_hz[i] = 2.0f * U5 - 3.0f * L;   // +wide, -narrow
        out.maj3_hz[i]  = 4.0f * U4 - 5.0f * L;   // +wide, -narrow
        out.min3_hz[i]  = 5.0f * U3 - 6.0f * L;   // +wide, -narrow
    }

    return out;
}

}} // namespace


