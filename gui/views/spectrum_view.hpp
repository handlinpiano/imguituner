// Minimal spectrum view renderer for ImGui
#pragma once

#include <imgui.h>
#include <vector>

namespace gui {

class SpectrumView {
public:
    // Options
    bool show_frequency_lines = true;
    bool show_peak_line = true;
    float bell_curve_width = 0.35f; // fisheye distortion
    int color_scheme_idx = 2;       // 0..N-1 (default Viridis)

    // New overlay controls
    bool show_target_line = true;         // 0 cents
    bool show_10_cent_lines = true;       // every 10 cents
    bool show_20_cent_lines = true;       // every 20 cents
    bool show_1_cent_lines = false;       // +/- 1 cent lines near target
    bool show_2_cent_lines = false;       // +/- 2 cent lines near target
    bool show_5_cent_lines = false;       // +/- 5 cent lines near target

    // Colors for overlays (ImGui style RGBA 0..1)
    ImVec4 color_target = ImVec4(0.47f, 0.78f, 1.00f, 0.90f);
    ImVec4 color_10_cent = ImVec4(0.63f, 0.63f, 0.63f, 0.70f);
    ImVec4 color_20_cent = ImVec4(0.80f, 0.80f, 0.80f, 0.80f);
    ImVec4 color_1_cent = ImVec4(0.90f, 0.20f, 0.20f, 0.85f);
    ImVec4 color_2_cent = ImVec4(0.20f, 0.90f, 0.20f, 0.85f);
    ImVec4 color_5_cent = ImVec4(0.90f, 0.70f, 0.20f, 0.85f);

    SpectrumView();

    // Draw spectrum bars + overlays within the given canvas
    void draw(ImDrawList* dl,
              const ImVec2& canvas_pos,
              float width,
              float height,
              const std::vector<float>& spectrum,
              float center_frequency_hz,
              float peak_frequency_hz,
              float peak_magnitude);

    struct ColorStop { float position; float r, g, b; };
    struct ColorScheme { const char* name; std::vector<ColorStop> stops; };
    const std::vector<ColorScheme>& schemes() const { return color_schemes; }

private:
    std::vector<ColorScheme> color_schemes;

    static inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
    static float fisheye_transform(float x01, float distortion);
    ImU32 color_from_scheme(float t01) const;
};

} // namespace gui


