#pragma once

#include <vector>

namespace gui { namespace temperaments {

struct BeatRates {
    std::vector<float> fifths_hz;  // signed: +wide, -narrow
    std::vector<float> maj3_hz;    // signed
    std::vector<float> min3_hz;    // signed
};

// note_cents: 12 values (C..B) deviations from ET (cents)
// a4_hz: A4 frequency (e.g., 440)
// Returns signed beat rates using:
// fifth: 2*U - 3*L, maj3: 4*U - 5*L, min3: 5*U - 6*L
BeatRates compute_signed_beats_from_cents(const std::vector<float>& note_cents, float a4_hz);

}}


