#include "long_analysis_view.hpp"

namespace gui {

void LongAnalysisView::render(LongAnalysisEngine& engine,
                              SpectrumView& spectrum_view,
                              float center_frequency_hz,
                              unsigned int effective_sample_rate,
                              int precise_fft_size,
                              int precise_decimation) {
    if (!show_window) return;
    if (!ImGui::Begin("Long Analysis", &show_window, ImGuiWindowFlags_MenuBar)) { ImGui::End(); return; }

    if (ImGui::BeginMenuBar()) {
        if (ImGui::BeginMenu("Settings")) {
            bool open = show_settings;
            if (ImGui::MenuItem("Long Analysis Settings", nullptr, open)) {
                show_settings = !show_settings;
            }
            ImGui::EndMenu();
        }
        ImGui::EndMenuBar();
    }

    ImGui::TextUnformatted("Averages:");
    ImGui::PushID("avg");
    for (int k = 1; k <= 8; ++k) {
        if (k > 1) ImGui::SameLine();
        char label[8]; snprintf(label, sizeof(label), "%dx", k);
        bool active = (num_segments == k);
        if (active) {
            ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(60, 160, 220, 200));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(80, 180, 240, 220));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(90, 190, 250, 255));
        }
        if (ImGui::Button(label)) { num_segments = k; engine.set_num_segments(k); }
        if (active) ImGui::PopStyleColor(3);
    }
    ImGui::PopID();
    ImGui::SameLine();
    ImGui::Text("  %s", engine.is_processing() ? "processing..." : "");

    ImGui::Separator();
    ImGui::TextUnformatted("Harmonics:");
    ImGui::PushID("harm");
    for (int h = 1; h <= 8; ++h) {
        if (h > 1) ImGui::SameLine();
        char hl[8]; snprintf(hl, sizeof(hl), "%dx", h);
        bool activeH = (num_harmonics == h);
        if (activeH) {
            ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(80, 140, 90, 200));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(100, 170, 120, 220));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(120, 190, 140, 255));
        }
        if (ImGui::Button(hl)) { num_harmonics = h; engine.set_num_harmonics(h); }
        if (activeH) ImGui::PopStyleColor(3);
    }
    ImGui::PopID();

    ImGui::Separator();
    ImGui::SliderFloat("Capture seconds", &capture_seconds, 1.0f, 8.0f, "%.1f s");
    bool capturing = engine.is_capturing();
    if (!capturing) {
        if (ImGui::Button("Start Capture")) {
            engine.configure(precise_fft_size, precise_decimation, 1200);
            engine.set_center_frequency(center_frequency_hz);
            engine.set_num_segments(num_segments);
            engine.set_num_harmonics(num_harmonics);
            engine.start_capture(capture_seconds, (int)effective_sample_rate);
        }
    } else { ImGui::TextUnformatted("Capturing..."); }

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
    ImVec2 m_av = ImGui::GetContentRegionAvail();
    const float width = std::max(200.0f, m_av.x);
    const float height = std::max(120.0f, m_av.y);
    const auto& long_spec = engine.spectrum();
    if (!long_spec.empty()) {
        spectrum_view.draw(dl, canvas_pos, width, height, long_spec, center_frequency_hz, 0.0f, 0.0f);
    } else {
        dl->AddRectFilled(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(20,20,20,255));
        dl->AddRect(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(60,60,60,255));
        dl->AddText(ImVec2(canvas_pos.x + 10, canvas_pos.y + 10), IM_COL32(200,200,200,255), "No data. Start a capture.");
    }

    const auto& hm = engine.harmonic_magnitudes();
    if (!hm.empty()) {
        ImGui::Separator();
        ImGui::TextUnformatted("Harmonic magnitudes (peak)");
        ImGui::PlotHistogram("##harmonics_hist", hm.data(), (int)hm.size(), 0, nullptr, 0.0f, 1.0f, ImVec2(0, 120));
        // Display table with n, ratio, cents, magnitude
        const auto& hrs = engine.harmonic_results();
        if (!hrs.empty()) {
            if (ImGui::BeginTable("harmonics_table", 5, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
                ImGui::TableSetupColumn("n");
                ImGui::TableSetupColumn("f (Hz)");
                ImGui::TableSetupColumn("ratio");
                ImGui::TableSetupColumn("cents");
                ImGui::TableSetupColumn("mag");
                ImGui::TableHeadersRow();
                for (const auto& hr : hrs) {
                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("%d", hr.n);
                    ImGui::TableSetColumnIndex(1); ImGui::Text("%.2f", hr.frequency_hz);
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%.3f", hr.ratio);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%+.2f", hr.cents);
                    ImGui::TableSetColumnIndex(4); ImGui::Text("%.3f", hr.magnitude);
                }
                ImGui::EndTable();
            }
            ImGui::Text("Inharmonicity B ≈ %.3e", engine.inharmonicity_B());
        }
    }

    if (show_settings) {
        ImGui::Separator();
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.06f, 0.06f, 0.07f, 0.95f));
        ImGui::BeginChild("LongSettingsPanel", ImVec2(0, 0), true);
        ImGui::TextUnformatted("Long Analysis Settings");
        ImGui::Text("FFT size: %d", precise_fft_size);
        ImGui::Text("Decimation: %d", precise_decimation);
        ImGui::Text("Sample rate: %u", effective_sample_rate);
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    ImGui::End();
}

} // namespace gui


