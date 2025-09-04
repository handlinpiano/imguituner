// Concentric circle tuner view for ImGui
#pragma once

#include <imgui.h>
#include <vector>

namespace gui {

class ConcentricView {
public:
    struct CircleConfig {
        float movement_range_cents;   // +/- range in cents covered by this circle
        float locking_tolerance_cents;// lock-in threshold within which the circle locks to center
        float radius_px;              // circle radius in pixels
        ImU32 color;                  // color used to draw
    };

    ConcentricView();

    // Global options
    bool lock_in_enabled = true;
    float fisheye_distortion = 0.35f; // shared with spectrum if desired
    int color_scheme_idx = 2; // reserved for future if needed

    // Access to circle configs for editing
    std::vector<CircleConfig>& circles() { return circles_; }
    const std::vector<CircleConfig>& circles() const { return circles_; }

    // Draw view within given canvas
    void draw(ImDrawList* dl,
              const ImVec2& canvas_pos,
              float width,
              float height,
              float center_frequency_hz,
              float peak_frequency_hz,
              float peak_magnitude);

private:
    std::vector<CircleConfig> circles_;

    static float fisheye_transform(float x01, float distortion);
    static float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
};

} // namespace gui


