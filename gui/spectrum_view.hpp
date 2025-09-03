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


