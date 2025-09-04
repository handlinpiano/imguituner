// Minimal waterfall view renderer for ImGui
#pragma once

#include <imgui.h>
#include <vector>
#include <deque>
#include "spectrum_view.hpp"

namespace gui {

class WaterfallView {
public:
    // Options
    static constexpr int default_max_rows = 2000;  // Plenty of historical data
    int max_rows = default_max_rows;
    // Fixed pixel height per waterfall row (prevents resize stretching)
    float row_px = 12.0f;
    bool use_texture = true; // default to texture path for full-height fill
    int color_scheme_idx = 2; // independent color scheme selection

    WaterfallView();

    // Add new spectrum data to the waterfall history
    void update(const std::vector<float>& spectrum);

    // Draw waterfall within the given canvas
    void draw(ImDrawList* dl,
              const ImVec2& canvas_pos,
              float width,
              float height,
              const SpectrumView& spectrum_view);

    // Clear the waterfall history
    void clear();

    // Get current number of filled rows
    int filled_rows() const { return filled_rows_; }

private:
    std::deque<std::vector<float>> history_;
    int filled_rows_ = 0;
    int current_cols_ = 0; // track consistent spectrum width

    // GPU texture-backed rendering
    unsigned int texture_id_ = 0; // GL texture id (GLuint)
    int tex_w_ = 0;
    int tex_h_ = 0;
    std::vector<unsigned char> tex_rgba_; // tex_w_ * tex_h_ * 4

    // Helper for color interpolation
    static inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
};

} // namespace gui
