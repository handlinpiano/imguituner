#include "spectrum_view.hpp"
#include <cmath>
#include <cstdio>

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
        // Target frequency highlight (window around 0 cents)
        if (show_target_line) {
            float xL = x_for_cents(-0.5f);
            float xR = x_for_cents(0.5f);
            ImU32 fill = IM_COL32((int)(color_target.x*255),(int)(color_target.y*255),(int)(color_target.z*255),(int)(color_target.w*80));
            ImU32 line = IM_COL32((int)(color_target.x*255),(int)(color_target.y*255),(int)(color_target.z*255),(int)(color_target.w*255));
            dl->AddRectFilled(ImVec2(xL, canvas_pos.y), ImVec2(xR, canvas_pos.y + height), fill);
            float xc = x_for_cents(0.0f);
            dl->AddLine(ImVec2(xc, canvas_pos.y), ImVec2(xc, canvas_pos.y + height), line, 2.0f);
        }
        // 10-cent lines across range
        if (show_10_cent_lines) {
            ImU32 col10 = IM_COL32((int)(color_10_cent.x*255),(int)(color_10_cent.y*255),(int)(color_10_cent.z*255),(int)(color_10_cent.w*255));
            for (int c = -120; c <= 120; c += 10) {
                if (c == 0) continue;
                float x = x_for_cents((float)c);
                dl->AddLine(ImVec2(x, canvas_pos.y), ImVec2(x, canvas_pos.y + height), col10, 1.0f);
            }
        }
        // 20-cent lines across range
        if (show_20_cent_lines) {
            ImU32 col20 = IM_COL32((int)(color_20_cent.x*255),(int)(color_20_cent.y*255),(int)(color_20_cent.z*255),(int)(color_20_cent.w*255));
            for (int c = -120; c <= 120; c += 20) {
                if (c == 0) continue;
                float x = x_for_cents((float)c);
                dl->AddLine(ImVec2(x, canvas_pos.y), ImVec2(x, canvas_pos.y + height), col20, 1.3f);
            }
        }
        // Fine lines at exact +/-1, +/-2, +/-5 cents only
        auto draw_pair = [&](int cents_abs, const ImVec4& colv, float thickness){
            ImU32 col = IM_COL32((int)(colv.x*255),(int)(colv.y*255),(int)(colv.z*255),(int)(colv.w*255));
            float x_pos = x_for_cents((float)cents_abs);
            float x_neg = x_for_cents((float)(-cents_abs));
            dl->AddLine(ImVec2(x_pos, canvas_pos.y), ImVec2(x_pos, canvas_pos.y + height), col, thickness);
            dl->AddLine(ImVec2(x_neg, canvas_pos.y), ImVec2(x_neg, canvas_pos.y + height), col, thickness);
        };
        if (show_1_cent_lines) draw_pair(1, color_1_cent, 1.0f);
        if (show_2_cent_lines) draw_pair(2, color_2_cent, 1.2f);
        if (show_5_cent_lines) draw_pair(5, color_5_cent, 1.4f);

        // Cent labels every 10c, plus +/-1c if enabled
        if (show_cent_labels) {
            ImU32 colLbl = IM_COL32((int)(color_cent_labels.x*255),(int)(color_cent_labels.y*255),(int)(color_cent_labels.z*255),(int)(color_cent_labels.w*255));
            float base_y = canvas_pos.y + height;
            auto size_for_index = [&](int idx){
                switch (idx) {
                    case 0: return 0.75f; // tiny
                    case 1: return 0.90f; // small
                    case 2: return 1.00f; // medium
                    case 3: return 1.25f; // large
                    default: return 1.00f;
                }
            };
            ImFont* font = ImGui::GetFont();
            float size_mul = size_for_index(cent_label_size);
            float font_px = ImGui::GetFontSize() * size_mul;
            auto draw_label = [&](int c){
                float x = x_for_cents((float)c);
                char buf[8];
                snprintf(buf, sizeof(buf), "%+dc", c);
                ImVec2 ts = font->CalcTextSizeA(font_px, FLT_MAX, 0.0f, buf);
                // small tick
                dl->AddLine(ImVec2(x, base_y), ImVec2(x, base_y - 6), colLbl, 1.0f);
                // text centered
                dl->AddText(font, font_px, ImVec2(x - ts.x * 0.5f, base_y - ts.y - 8), colLbl, buf);
            };
            for (int c = -120; c <= 120; c += 10) {
                if (c == 0) continue;
                draw_label(c);
            }
            if (show_1_cent_lines) { draw_label(-1); draw_label(1); }
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


