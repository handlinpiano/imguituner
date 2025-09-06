#include "inharmonicity_window.hpp"
#include <imgui.h>
#include <cmath>

namespace gui {

void render_inharmonicity_window(NotesState& state,
                                 const tuner::SessionSettings& session,
                                 bool& open) {
    if (!open) return;
    if (!ImGui::Begin("Inharmonicity Calculations", &open)) { ImGui::End(); return; }

    auto& tr = state.tracker();
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
        // float c = tr.estimate_cents();
        // For small B, approx cents ≈ 600*log2((1+4B)/(1+B)) ≈ 600*log2(1+3B) ≈ 600*(3B/ln2)
        // We just display the cents for now; full B fit requires multi-partial input.
        ImGui::TextDisabled("A4 ref: %.2f Hz (%+.1f cents)", 440.0f * std::pow(2.0f, session.a4_offset_cents/1200.0f), session.a4_offset_cents);
    }

    ImGui::Separator();
    // Live readout for B estimates (latest values)
    render_inharmonicity_live_readout(state);
    // Simplified convergence settings
    auto bcfg = state.b_conv_config();
    bool changed = false;
    changed |= ImGui::SliderFloat("SNR min (harmonics)", &bcfg.snr_min, 0.5f, 10.0f, "%.2f");
    changed |= ImGui::SliderFloat("Within-frame MAD (B)", &bcfg.tau_pair_mad, 0.0001f, 0.0020f, "%.4f");
    changed |= ImGui::SliderFloat("Temporal tolerance (B)", &bcfg.tau_time, 0.00005f, 0.0010f, "%.5f");
    changed |= ImGui::SliderInt("Consecutive frames to lock", &bcfg.required_consecutive, 2, 40);
    if (changed) state.set_b_conv_config(bcfg);

    // Optional plot of B histories
    if (ImGui::CollapsingHeader("Inharmonicity B Plot", ImGuiTreeNodeFlags_DefaultOpen)) {
        static gui::InharmonicityBView bview;
        ImGui::SliderFloat("Y max B", &bview.y_max_B, 0.001f, 0.02f, "%.4f");
        ImGui::TextDisabled("Show harmonics:"); ImGui::SameLine();
        for (int k = 2; k <= 8; ++k) {
            char label[8]; snprintf(label, sizeof(label), "H%d", k);
            ImGui::SameLine(); ImGui::Checkbox(label, &bview.show_harmonic[k]);
        }
        ImGui::Text("Convergence: %s  (B=%.6f)", state.b_converged() ? "LOCKED" : "searching", state.b_converged() ? state.b_converged_value() : 0.0f);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
        ImVec2 m_av = ImGui::GetContentRegionAvail();
        float width = std::max(200.0f, m_av.x);
        float height = std::max(120.0f, m_av.y * 0.5f);
        bview.draw(dl, canvas_pos, width, height, state);
        ImGui::Dummy(ImVec2(width, height));
    }

    // New accordions for harmonic policy
    if (ImGui::CollapsingHeader("Harmonics: Baseline (initially enabled)", ImGuiTreeNodeFlags_DefaultOpen)) {
        auto base = state.baseline_config();
        bool baseChanged = false;
        baseChanged |= ImGui::SliderInt("Lower range end index", &base.lower_end_index, 0, 87);
        baseChanged |= ImGui::SliderInt("Middle range end index", &base.middle_end_index, 0, 87);
        baseChanged |= ImGui::SliderInt("Lower initial max (H)", &base.lower_initial_max, 1, base.absolute_max);
        baseChanged |= ImGui::SliderInt("Middle initial max (H)", &base.middle_initial_max, 1, base.absolute_max);
        baseChanged |= ImGui::SliderInt("Upper initial max (H)", &base.upper_initial_max, 1, base.absolute_max);
        baseChanged |= ImGui::SliderInt("Absolute cap (H)", &base.absolute_max, 2, 8);
        if (baseChanged) state.set_baseline_config(base);
        ImGui::TextDisabled("Current note initial max H: %d", state.initial_max_harmonic_current());
    }

    if (ImGui::CollapsingHeader("Harmonics: Progressive enablement", ImGuiTreeNodeFlags_DefaultOpen)) {
        auto pcfg = state.progressive_config();
        bool pChanged = false;
        pChanged |= ImGui::SliderFloat("r2_min (mag2/mag1)", &pcfg.r2_min, 0.01f, 0.5f, "%.3f");
        pChanged |= ImGui::SliderFloat("r_next_scale", &pcfg.r_next_scale, 0.01f, 0.2f, "%.3f");
        pChanged |= ImGui::SliderInt("Kmin stable (captures)", &pcfg.kmin_stable, 1, 50);
        pChanged |= ImGui::SliderFloat("MAD stable (cents)", &pcfg.mad_stable_cents, 0.05f, 2.0f, "%.2f");
        if (pChanged) state.set_progressive_config(pcfg);
    }

    ImGui::End();
}

}


