#include "settings_page.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>

namespace gui {

void SettingsPage::render(float& center_frequency_hz,
                          int& precise_fft_size,
                          int& precise_decimation,
                          float& precise_window_seconds,
                          int& /*frontend_decimation*/,
                          SpectrumView& spectrum_view,
                          WaterfallView* waterfall_view,
                          int& waterfall_stride,
                          ConcentricView* concentric_view) {
    if (ImGui::BeginTabBar("SettingsTabs")) {
        if (ImGui::BeginTabItem("General")) {
            ImGui::Text("FFT Size: 16384 (fixed)");
            precise_fft_size = 16384;
            ImGui::SliderInt("Precise D", &precise_decimation, 4, 64);
            ImGui::SliderFloat("Precise Window (s)", &precise_window_seconds, 0.10f, 2.00f, "%.2f s");
            ImGui::TextDisabled("Note/Center frequency is controlled in the Notes window.");
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Spectrum")) {
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
            ImGui::Checkbox("Show X-axis cent labels", &spectrum_view.show_cent_labels);
            ImGui::SliderInt("Label size", &spectrum_view.cent_label_size, 0, 3);
            ImGui::ColorEdit4("Label color", (float*)&spectrum_view.color_cent_labels, ImGuiColorEditFlags_NoInputs);
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
            ImGui::EndTabItem();
        }
        if (concentric_view && ImGui::BeginTabItem("Concentric")) {
            ImGui::Checkbox("Lock-in enabled", &concentric_view->lock_in_enabled);
            ImGui::SliderFloat("Concentric fisheye", &concentric_view->fisheye_distortion, 0.0f, 2.0f, "%.2f");
            auto& circles = concentric_view->circles();
            for (size_t i = 0; i < circles.size(); ++i) {
                char label[32]; snprintf(label, sizeof(label), "Circle %zu", i + 1);
                if (ImGui::TreeNode(label)) {
                    ImGui::SliderFloat("Movement range (±cents)", &circles[i].movement_range_cents, 1.0f, 120.0f, "%.0f");
                    float min_tol = (i + 1 == circles.size()) ? 0.25f : 1.0f;
                    const char* fmt_tol = (i + 1 == circles.size()) ? "%.2f" : "%.0f";
                    ImGui::SliderFloat("Locking tolerance (±cents)", &circles[i].locking_tolerance_cents, min_tol, 50.0f, fmt_tol);
                    ImGui::SliderFloat("Radius (px)", &circles[i].radius_px, 6.0f, 80.0f, "%.0f");
                    ImVec4 col = ImGui::ColorConvertU32ToFloat4(circles[i].color);
                    if (ImGui::ColorEdit4("Color", (float*)&col, ImGuiColorEditFlags_NoInputs)) {
                        circles[i].color = ImGui::ColorConvertFloat4ToU32(col);
                    }
                    ImGui::TreePop();
                }
            }
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Waterfall")) {
            const auto& schemes2 = spectrum_view.schemes();
            if (waterfall_view) {
                int widx = waterfall_view->color_scheme_idx;
                const char* preview = schemes2[std::max(0, std::min((int)schemes2.size()-1, widx))].name;
                if (ImGui::BeginCombo("Color scheme##waterfall", preview)) {
                    for (int i = 0; i < (int)schemes2.size(); ++i) {
                        bool selected = (i == widx);
                        if (ImGui::Selectable(schemes2[i].name, selected)) { widx = i; waterfall_view->color_scheme_idx = i; }
                        if (selected) ImGui::SetItemDefaultFocus();
                    }
                    ImGui::EndCombo();
                }
                ImGui::Separator();
                ImGui::Checkbox("Target frequency line", &waterfall_view->show_target_line);
                ImGui::Checkbox("10 cent lines", &waterfall_view->show_10_cent_lines);
                ImGui::Checkbox("20 cent lines", &waterfall_view->show_20_cent_lines);
                ImGui::Checkbox("1 cent lines", &waterfall_view->show_1_cent_lines);
                ImGui::Checkbox("2 cent lines", &waterfall_view->show_2_cent_lines);
                ImGui::Checkbox("5 cent lines", &waterfall_view->show_5_cent_lines);
                ImGui::ColorEdit4("Target color", (float*)&waterfall_view->color_target, ImGuiColorEditFlags_NoInputs);
                ImGui::ColorEdit4("10-cent color", (float*)&waterfall_view->color_10_cent, ImGuiColorEditFlags_NoInputs);
                ImGui::ColorEdit4("20-cent color", (float*)&waterfall_view->color_20_cent, ImGuiColorEditFlags_NoInputs);
                ImGui::ColorEdit4("1-cent color", (float*)&waterfall_view->color_1_cent, ImGuiColorEditFlags_NoInputs);
                ImGui::ColorEdit4("2-cent color", (float*)&waterfall_view->color_2_cent, ImGuiColorEditFlags_NoInputs);
                ImGui::ColorEdit4("5-cent color", (float*)&waterfall_view->color_5_cent, ImGuiColorEditFlags_NoInputs);
            }
            ImGui::TextUnformatted("Speed");
            ImGui::SliderInt("Waterfall Stride (1=fast)", &waterfall_stride, 1, 20);
            ImGui::SameLine();
            ImGui::Text("x%.1f", 1.0f / (float)std::max(1, waterfall_stride));
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Notes Capture")) {
            ImGui::TextUnformatted("Capture / Lock Settings");
            // Access global NotesController via a simple registry would be better; for now expose basic knobs
            // These will be fetched/applied from the owning main window when rendering settings.
            static int capture_period = 40;
            static int max_caps = 10;
            static float snr_min = 3.0f;
            static float balance_min = 0.05f; // 5%
            static float mad_lock = 0.4f;
            static float max_err = 15.0f;
            ImGui::SliderInt("Period (frames)", &capture_period, 5, 120);
            ImGui::SliderInt("Max captures", &max_caps, 3, 30);
            ImGui::SliderFloat("SNR min (peak/mean)", &snr_min, 1.0f, 10.0f, "%.2f");
            ImGui::SliderFloat("Balance min (weaker/stronger)", &balance_min, 0.0f, 0.5f, "%.2f");
            ImGui::SliderFloat("MAD lock (cents)", &mad_lock, 0.1f, 2.0f, "%.2f");
            ImGui::SliderFloat("Max |error| (cents)", &max_err, 5.0f, 50.0f, "%.1f");
            ImGui::TextDisabled("Apply in Notes window > Capture params (debug)");
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
}

} // namespace gui


