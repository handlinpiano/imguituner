#include "concentric_view.hpp"
#include <cmath>
#include <cstdio>

namespace gui {

ConcentricView::ConcentricView() {
    // Default three circles with progressively tighter locking
    circles_.push_back({ 120.0f, 25.0f, 26.0f, IM_COL32(255, 128, 0, 255) });
    circles_.push_back({ 60.0f, 10.0f, 18.0f, IM_COL32(0, 200, 255, 255) });
    circles_.push_back({ 20.0f,  1.0f, 12.0f, IM_COL32(0, 255, 128, 255) }); // supports down to 0.25 via UI
}

float ConcentricView::fisheye_transform(float x01, float distortion) {
    float normalizedX = (x01 - 0.5f) * 2.0f;
    float absx = std::fabs(normalizedX);
    float transformed;
    if (distortion > 0.0f) {
        transformed = (normalizedX >= 0.0f ? absx : -absx) / (1.0f + absx * distortion);
        transformed = transformed * (1.0f + distortion);
    } else {
        transformed = normalizedX;
    }
    return transformed * 0.5f + 0.5f;
}

void ConcentricView::draw(ImDrawList* dl,
                          const ImVec2& canvas_pos,
                          float width,
                          float height,
                          float center_frequency_hz,
                          float peak_frequency_hz,
                          float peak_magnitude) {
    if (!dl || width <= 0 || height <= 0 || center_frequency_hz <= 0.0f) return;

    // Background
    const ImVec2 p0 = canvas_pos;
    const ImVec2 p1 = ImVec2(canvas_pos.x + width, canvas_pos.y + height);
    dl->AddRectFilled(p0, p1, IM_COL32(20,20,22,255));
    dl->AddRect(p0, p1, IM_COL32(60,60,60,255));

    const float center_y = canvas_pos.y + height * 0.5f;

    // Axis line and center marker
    dl->AddLine(ImVec2(canvas_pos.x, center_y), ImVec2(canvas_pos.x + width, center_y), IM_COL32(160,160,160,80), 2.0f);
    // center target line (0 cents)
    float x_center = canvas_pos.x + fisheye_transform(0.5f, fisheye_distortion) * width;
    dl->AddLine(ImVec2(x_center, canvas_pos.y + height * 0.25f), ImVec2(x_center, canvas_pos.y + height * 0.75f), IM_COL32(220,220,220,230), 3.0f);

    // Compute cents offset of peak
    float peak_cents = 0.0f;
    if (peak_frequency_hz > 0.0f) {
        peak_cents = 1200.0f * std::log2(peak_frequency_hz / center_frequency_hz);
        if (peak_cents < -120.0f) peak_cents = -120.0f;
        if (peak_cents > 120.0f) peak_cents = 120.0f;
    }

    // Draw each circle indicator
    for (size_t i = 0; i < circles_.size(); ++i) {
        const CircleConfig& cfg = circles_[i];

        // Determine lock state
        bool is_locked = lock_in_enabled && std::fabs(peak_cents) <= cfg.locking_tolerance_cents && peak_magnitude > 0.0f;

        // Determine x position within movement range, or center if locked
        float x_norm;
        if (is_locked) {
            x_norm = 0.5f;
        } else {
            float movement_range = cfg.movement_range_cents;
            if (movement_range < 1.0f) movement_range = 1.0f;
            if (movement_range > 120.0f) movement_range = 120.0f;
            float t = (peak_cents + movement_range) / (2.0f * movement_range);
            x_norm = clamp01(t);
        }
        float xf = fisheye_transform(x_norm, fisheye_distortion);
        float xp = canvas_pos.x + xf * width;

        // Opacity varies with magnitude (simple mapping)
        float opacity = peak_magnitude > 0.0f ? 0.2f + 0.8f * clamp01(peak_magnitude) : 0.3f;

        // Draw precision line for the innermost circle
        if (i + 1 == circles_.size()) {
            dl->AddLine(ImVec2(xp, canvas_pos.y), ImVec2(xp, canvas_pos.y + height), IM_COL32(0,0,0,(int)(opacity * 255)), 2.0f);
        }

        // Draw circle
        ImU32 color = cfg.color;
        ImU32 color_with_alpha = IM_COL32((int)((color >> IM_COL32_R_SHIFT) & 0xFF),
                                          (int)((color >> IM_COL32_G_SHIFT) & 0xFF),
                                          (int)((color >> IM_COL32_B_SHIFT) & 0xFF),
                                          (int)(opacity * 255));

        dl->AddCircle(ImVec2(xp, center_y), cfg.radius_px, color_with_alpha, 0, 3.0f);

        // Label showing tolerance
        char buf[32];
        if (i + 1 == circles_.size()) snprintf(buf, sizeof(buf), "±%.2f¢", cfg.locking_tolerance_cents);
        else snprintf(buf, sizeof(buf), "±%.0f¢", cfg.locking_tolerance_cents);
        dl->AddText(ImVec2(xp, center_y + cfg.radius_px + 8.0f), color_with_alpha, buf);
    }
}

} // namespace gui


