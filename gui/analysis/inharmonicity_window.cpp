#include "analysis/inharmonicity_window.hpp"
#include <imgui.h>
#include <cmath>

namespace gui {

void render_inharmonicity_window(const NotesState& state,
                                 const tuner::SessionSettings& session,
                                 bool& open) {
    if (!open) return;
    if (!ImGui::Begin("Inharmonicity Calculations", &open)) { ImGui::End(); return; }

    const auto& tr = state.tracker();
    ImGui::Text("Captures: %d/%d %s", tr.captures_count(), tr.max_captures(), tr.locked() ? "[LOCKED]" : "");
    if (tr.last_capture_valid()) {
        ImGui::Text("Last: %.2f cents | snr0=%.2f snr2=%.2f", tr.last_capture_cents(), tr.last_capture_snr0(), tr.last_capture_snr2());
    } else {
        ImGui::Text("Last: rejected (%s)", tr.last_capture_reason().empty() ? "n/a" : tr.last_capture_reason().c_str());
    }

    if (tr.has_estimate()) {
        ImGui::Separator();
        ImGui::Text("Median 2:1 error: %.2f cents (MAD %.2f)", tr.estimate_cents(), tr.estimate_mad_cents());
        // Show rough B estimate bounds from cents error
        float c = tr.estimate_cents();
        // For small B, approx cents ≈ 600*log2((1+4B)/(1+B)) ≈ 600*log2(1+3B) ≈ 600*(3B/ln2)
        // We just display the cents for now; full B fit requires multi-partial input.
        ImGui::TextDisabled("A4 ref: %.2f Hz (%+.1f cents)", 440.0f * std::pow(2.0f, session.a4_offset_cents/1200.0f), session.a4_offset_cents);
    }

    ImGui::End();
}

}


