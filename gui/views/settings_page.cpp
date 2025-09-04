#include "settings_page.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>

namespace gui {

void SettingsPage::render(float& center_frequency_hz,
                          int& precise_fft_size,
                          int& precise_decimation,
                          float& precise_window_seconds,
                          int& frontend_decimation,
                          SpectrumView& spectrum_view,
                          WaterfallView* waterfall_view,
                          int& waterfall_stride,
                          ConcentricView* concentric_view) {
    if (ImGui::CollapsingHeader("General FFT", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderFloat("Center Freq", &center_frequency_hz, 200.0f, 1000.0f, "%.1f Hz");
        ImGui::Text("FFT Size: 16384 (fixed)");
        precise_fft_size = 16384;
        ImGui::SliderInt("Precise D", &precise_decimation, 4, 64);
        ImGui::SliderFloat("Precise Window (s)", &precise_window_seconds, 0.20f, 0.60f, "%.2f s");
        ImGui::SliderInt("Frontend decim", &frontend_decimation, 1, 4);
    }
    // Waterfall speed slider: 1=fastest, 20=slowest
    {
        int speed_percent = (int)std::round(100.0f * (1.0f - (float)(std::max(1, waterfall_stride) - 1) / 19.0f));
        ImGui::SliderInt("Waterfall Speed", &speed_percent, 1, 100);
        float t = 1.0f - (speed_percent / 100.0f);
        float maxStride = 20.0f;
        waterfall_stride = std::max(1, (int)std::round(1.0f + t * t * (maxStride - 1.0f)));
        ImGui::SameLine();
        ImGui::Text("x%.1f", 1.0f / (float)std::max(1, waterfall_stride));
    }
    if (ImGui::CollapsingHeader("Spectrum Settings", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::Checkbox("Show frequency lines", &spectrum_view.show_frequency_lines);
        ImGui::SameLine();
        ImGui::Checkbox("Show peak line", &spectrum_view.show_peak_line);
        ImGui::SliderFloat("Fisheye (bell)", &spectrum_view.bell_curve_width, 0.0f, 2.0f, "%.2f");
        ImGui::Separator();
        ImGui::Checkbox("Target frequency line", &spectrum_view.show_target_line);
        ImGui::Checkbox("10 cent lines", &spectrum_view.show_10_cent_lines);
        ImGui::Checkbox("20 cent lines", &spectrum_view.show_20_cent_lines);
        ImGui::Checkbox("1 cent lines", &spectrum_view.show_1_cent_lines);
        ImGui::Checkbox("2 cent lines", &spectrum_view.show_2_cent_lines);
        ImGui::Checkbox("5 cent lines", &spectrum_view.show_5_cent_lines);
        ImGui::ColorEdit4("Target color", (float*)&spectrum_view.color_target, ImGuiColorEditFlags_NoInputs);
        ImGui::ColorEdit4("10-cent color", (float*)&spectrum_view.color_10_cent, ImGuiColorEditFlags_NoInputs);
        ImGui::ColorEdit4("20-cent color", (float*)&spectrum_view.color_20_cent, ImGuiColorEditFlags_NoInputs);
        ImGui::ColorEdit4("1-cent color", (float*)&spectrum_view.color_1_cent, ImGuiColorEditFlags_NoInputs);
        ImGui::ColorEdit4("2-cent color", (float*)&spectrum_view.color_2_cent, ImGuiColorEditFlags_NoInputs);
        ImGui::ColorEdit4("5-cent color", (float*)&spectrum_view.color_5_cent, ImGuiColorEditFlags_NoInputs);
        const auto& schemes = spectrum_view.schemes();
        int idx = spectrum_view.color_scheme_idx;
        if (ImGui::BeginCombo("Color scheme##spectrum", schemes[idx].name)) {
            for (int i = 0; i < (int)schemes.size(); ++i) {
                bool selected = (i == idx);
                if (ImGui::Selectable(schemes[i].name, selected)) { idx = i; spectrum_view.color_scheme_idx = i; }
                if (selected) ImGui::SetItemDefaultFocus();
            }
            ImGui::EndCombo();
        }
    }

    // Concentric view controls (optional)
    if (concentric_view) {
        ImGui::Separator();
        ImGui::TextUnformatted("Concentric View");
        ImGui::Checkbox("Lock-in enabled", &concentric_view->lock_in_enabled);
        ImGui::SliderFloat("Concentric fisheye", &concentric_view->fisheye_distortion, 0.0f, 2.0f, "%.2f");

        auto& circles = concentric_view->circles();
        for (size_t i = 0; i < circles.size(); ++i) {
            char label[32]; snprintf(label, sizeof(label), "Circle %zu", i + 1);
            if (ImGui::TreeNode(label)) {
                ImGui::SliderFloat("Movement range (±cents)", &circles[i].movement_range_cents, 5.0f, 200.0f, "%.0f");
                float min_tol = (i + 1 == circles.size()) ? 0.25f : 1.0f;
                const char* fmt_tol = (i + 1 == circles.size()) ? "%.2f" : "%.0f";
                ImGui::SliderFloat("Locking tolerance (±cents)", &circles[i].locking_tolerance_cents, min_tol, 50.0f, fmt_tol);
                ImGui::SliderFloat("Radius (px)", &circles[i].radius_px, 6.0f, 40.0f, "%.0f");
                ImGui::TreePop();
            }
        }
    }

    // Waterfall settings
    if (ImGui::CollapsingHeader("Waterfall Settings", ImGuiTreeNodeFlags_DefaultOpen)) {
        // Reuse spectrum schemes list for palette names
        const auto& schemes = spectrum_view.schemes();
        if (waterfall_view) {
            int widx = waterfall_view->color_scheme_idx;
            const char* preview = schemes[std::max(0, std::min((int)schemes.size()-1, widx))].name;
            if (ImGui::BeginCombo("Color scheme##waterfall", preview)) {
                for (int i = 0; i < (int)schemes.size(); ++i) {
                    bool selected = (i == widx);
                    if (ImGui::Selectable(schemes[i].name, selected)) { widx = i; waterfall_view->color_scheme_idx = i; }
                    if (selected) ImGui::SetItemDefaultFocus();
                }
                ImGui::EndCombo();
            }
        }
        // Show dropdown bound to WaterfallView's color_scheme_idx through a pointer later in main
        // We expose a slider here for speed still
        ImGui::TextUnformatted("Speed");
        {
            int speed_percent = (int)std::round(100.0f * (1.0f - (float)(std::max(1, waterfall_stride) - 1) / 19.0f));
            ImGui::SliderInt("Waterfall Speed", &speed_percent, 1, 100);
            float t = 1.0f - (speed_percent / 100.0f);
            float maxStride = 20.0f;
            waterfall_stride = std::max(1, (int)std::round(1.0f + t * t * (maxStride - 1.0f)));
            ImGui::SameLine();
            ImGui::Text("x%.1f", 1.0f / (float)std::max(1, waterfall_stride));
        }
    }
}

} // namespace gui


