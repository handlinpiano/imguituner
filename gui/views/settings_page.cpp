#include "settings_page.hpp"
#include <algorithm>
#include <cmath>

namespace gui {

void SettingsPage::render(float& center_frequency_hz,
                          int& precise_fft_size,
                          int& precise_decimation,
                          float& precise_window_seconds,
                          int& frontend_decimation,
                          SpectrumView& spectrum_view,
                          int& waterfall_stride) {
    if (ImGui::SliderFloat("Center Freq", &center_frequency_hz, 200.0f, 1000.0f, "%.1f Hz")) {}
    ImGui::Text("FFT Size: 16384 (fixed)");
    precise_fft_size = 16384;
    ImGui::SliderInt("Precise D", &precise_decimation, 4, 64);
    ImGui::SliderFloat("Precise Window (s)", &precise_window_seconds, 0.20f, 0.60f, "%.2f s");
    ImGui::SliderInt("Frontend decim", &frontend_decimation, 1, 4);
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


