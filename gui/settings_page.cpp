#include "settings_page.hpp"

namespace gui {

void SettingsPage::render(float& center_frequency_hz,
                          int& precise_fft_size,
                          int& precise_decimation,
                          float& precise_window_seconds,
                          int& frontend_decimation,
                          SpectrumView& spectrum_view) {
    if (ImGui::SliderFloat("Center Freq", &center_frequency_hz, 200.0f, 1000.0f, "%.1f Hz")) {}
    ImGui::Text("FFT Size: 16384 (fixed)");
    precise_fft_size = 16384;
    ImGui::SliderInt("Precise D", &precise_decimation, 4, 64);
    ImGui::SliderFloat("Precise Window (s)", &precise_window_seconds, 0.20f, 0.60f, "%.2f s");
    ImGui::SliderInt("Frontend decim", &frontend_decimation, 1, 4);
    ImGui::Checkbox("Show frequency lines", &spectrum_view.show_frequency_lines);
    ImGui::SameLine();
    ImGui::Checkbox("Show peak line", &spectrum_view.show_peak_line);
    ImGui::SliderFloat("Fisheye (bell)", &spectrum_view.bell_curve_width, 0.0f, 2.0f, "%.2f");

    const auto& schemes = spectrum_view.schemes();
    int idx = spectrum_view.color_scheme_idx;
    if (ImGui::BeginCombo("Color scheme", schemes[idx].name)) {
        for (int i = 0; i < (int)schemes.size(); ++i) {
            bool selected = (i == idx);
            if (ImGui::Selectable(schemes[i].name, selected)) { idx = i; spectrum_view.color_scheme_idx = i; }
            if (selected) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }
}

} // namespace gui


