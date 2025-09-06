#pragma once

#include "tuning/notes_state.hpp"
#include "tuner/session_settings.hpp"
#include "views/inharmonicity_b_view.hpp"

namespace gui {

// Simple window to inspect captured octave/partial details and derived stats.
void render_inharmonicity_window(NotesState& state,
                                 const tuner::SessionSettings& session,
                                 bool& open);

// Live readout helpers for use by inharmonicity window
inline void render_inharmonicity_live_readout(const NotesState& state) {
    float Bw = state.magnitude_weighted_average_b();
    ImGui::Text("Weighted B: %.6f", Bw);
    ImGui::Separator();
    ImGui::TextDisabled("Latest per-harmonic B:");
    for (int k = 2; k <= 8; ++k) {
        const auto& q = state.b_history_for_harmonic(k);
        float v = q.empty() ? 0.0f : q.back();
        ImGui::Text("H%d: %.6f", k, v);
    }
}

}


