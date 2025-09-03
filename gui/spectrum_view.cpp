#include "spectrum_view.hpp"
#include <cmath>

namespace gui {

SpectrumView::SpectrumView() {
    color_schemes = {
        {"Grayscale", {{0.0f,0.10f,0.10f,0.10f},{0.5f,0.50f,0.50f,0.50f},{1.0f,1.00f,1.00f,1.00f}}},
        {"Jet", {{0.00f,0.00f,0.00f,0.50f},{0.25f,0.00f,0.50f,1.00f},{0.50f,0.00f,1.00f,0.00f},{0.75f,1.00f,1.00f,0.00f},{1.00f,1.00f,0.00f,0.00f}}},
        {"Viridis", {{0.00f,0.267f,0.005f,0.329f},{0.25f,0.253f,0.265f,0.529f},{0.50f,0.127f,0.567f,0.551f},{0.75f,0.369f,0.787f,0.382f},{1.00f,0.993f,0.906f,0.144f}}},
        {"Thermal", {{0.00f,0.00f,0.00f,0.00f},{0.30f,0.50f,0.00f,0.00f},{0.60f,1.00f,0.50f,0.00f},{0.80f,1.00f,0.80f,0.20f},{1.00f,1.00f,1.00f,1.00f}}},
        {"Batlow", {{0.00f,0.005f,0.089f,0.209f},{0.25f,0.107f,0.288f,0.399f},{0.50f,0.458f,0.444f,0.444f},{0.75f,0.796f,0.555f,0.322f},{1.00f,0.993f,0.747f,0.009f}}},
    };
}

float SpectrumView::fisheye_transform(float x01, float distortion) {
    float normalizedX = (x01 - 0.5f) * 2.0f;
    float transformed = 0.0f;
    float absx = std::fabs(normalizedX);
    if (distortion > 0.0f) {
        transformed = (normalizedX >= 0.0f ? absx : -absx) / (1.0f + absx * distortion);
        transformed = transformed * (1.0f + distortion);
    } else {
        transformed = normalizedX;
    }
    return transformed * 0.5f + 0.5f;
}

ImU32 SpectrumView::color_from_scheme(float t01) const {
    t01 = clamp01(t01);
    const auto& scheme = color_schemes[color_scheme_idx];
    if (scheme.stops.empty()) return IM_COL32(255,255,255,255);
    if (t01 <= scheme.stops.front().position) {
        const auto& s = scheme.stops.front();
        return IM_COL32((int)(s.r*255), (int)(s.g*255), (int)(s.b*255), 255);
    }
    for (size_t i = 0; i + 1 < scheme.stops.size(); ++i) {
        const auto& a = scheme.stops[i];
        const auto& b = scheme.stops[i+1];
        if (t01 <= b.position) {
            float span = (b.position - a.position);
            float u = span > 0.0f ? (t01 - a.position) / span : 0.0f;
            float r = a.r + (b.r - a.r) * u;
            float g = a.g + (b.g - a.g) * u;
            float bc = a.b + (b.b - a.b) * u;
            return IM_COL32((int)(r*255), (int)(g*255), (int)(bc*255), 255);
        }
    }
    const auto& e = scheme.stops.back();
    return IM_COL32((int)(e.r*255), (int)(e.g*255), (int)(e.b*255), 255);
}

void SpectrumView::draw(ImDrawList* dl,
                        const ImVec2& canvas_pos,
                        float width,
                        float height,
                        const std::vector<float>& spectrum,
                        float center_frequency_hz,
                        float peak_frequency_hz,
                        float peak_magnitude) {
    if (!dl || spectrum.empty() || width <= 0 || height <= 0) return;

    // Background frame
    dl->AddRectFilled(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(20,20,20,255));
    dl->AddRect(canvas_pos, ImVec2(canvas_pos.x + width, canvas_pos.y + height), IM_COL32(60,60,60,255));

    float max_mag = 0.0f; for (float v : spectrum) if (v > max_mag) max_mag = v; if (max_mag <= 0.0f) max_mag = 1.0f;
    const int numBins = static_cast<int>(spectrum.size());
    const float base_y = canvas_pos.y + height;

    // Bars
    for (int i = 0; i < numBins; ++i) {
        float x0_norm = static_cast<float>(i) / static_cast<float>(numBins);
        float x1_norm = static_cast<float>(i + 1) / static_cast<float>(numBins);
        float x0 = fisheye_transform(x0_norm, bell_curve_width);
        float x1 = fisheye_transform(x1_norm, bell_curve_width);
        float px0 = canvas_pos.x + x0 * width;
        float px1 = canvas_pos.x + x1 * width;
        float mag = spectrum[i];
        float h = std::fmin(1.0f, mag / max_mag) * height;
        ImU32 color = color_from_scheme(mag / max_mag);
        dl->AddRectFilled(ImVec2(px0, base_y - h), ImVec2(px1, base_y), color);
    }

    // Overlays
    if (show_frequency_lines) {
        auto x_for_cents = [&](float cents) {
            float norm = (cents + 120.0f) / 240.0f;
            float xf = fisheye_transform(norm, bell_curve_width);
            return canvas_pos.x + xf * width;
        };
        float xL = x_for_cents(-0.5f);
        float xR = x_for_cents(0.5f);
        dl->AddRectFilled(ImVec2(xL, canvas_pos.y), ImVec2(xR, canvas_pos.y + height), IM_COL32(80,160,255,50));
        float xc = x_for_cents(0.0f);
        dl->AddLine(ImVec2(xc, canvas_pos.y), ImVec2(xc, canvas_pos.y + height), IM_COL32(120,200,255,220), 2.0f);
        for (int c = -100; c <= 100; c += 10) {
            if (c == 0) continue;
            float x = x_for_cents((float)c);
            ImU32 col = (std::abs(c) == 100) ? IM_COL32(200,200,200,160) : IM_COL32(160,160,160,120);
            dl->AddLine(ImVec2(x, canvas_pos.y), ImVec2(x, canvas_pos.y + height), col, 1.0f);
        }
    }

    if (show_peak_line && peak_magnitude > 0.0f) {
        float cents = 1200.0f * std::log2(peak_frequency_hz / center_frequency_hz);
        if (cents > -120.0f && cents < 120.0f) {
            float norm = (cents + 120.0f) / 240.0f;
            float xf = fisheye_transform(norm, bell_curve_width);
            float xp = canvas_pos.x + xf * width;
            dl->AddLine(ImVec2(xp, canvas_pos.y), ImVec2(xp, canvas_pos.y + height), IM_COL32(204,0,0,230), 3.0f);
        }
    }
}

} // namespace gui


