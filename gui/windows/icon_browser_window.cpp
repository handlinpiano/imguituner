#include "icon_browser_window.hpp"

#include <imgui.h>
#include <cstdio>

namespace gui {

void render_icon_browser_window(bool& open) {
    if (!open) return;
    if (ImGui::Begin("Icon Browser", &open)) {
        ImGui::TextUnformatted("Click a glyph to copy its codepoint (U+XXXX) to the clipboard.");
        ImGui::Separator();
        ImGuiIO& io = ImGui::GetIO();
        ImFont* icon_font = nullptr;
        if (!io.Fonts->Fonts.empty()) icon_font = io.Fonts->Fonts.back();
        if (icon_font) {
            int items_in_row = 10;
            int col = 0;
            for (int cp = 0xE000; cp <= 0xF8FF; ++cp) {
                char utf8[5] = {};
                ImWchar w = (ImWchar)cp;
                if (w < 0x80) { utf8[0] = (char)w; utf8[1] = 0; }
                else if (w < 0x800) { utf8[0] = (char)(0xC0 | (w >> 6)); utf8[1] = (char)(0x80 | (w & 0x3F)); utf8[2] = 0; }
                else if (w < 0x10000) { utf8[0] = (char)(0xE0 | (w >> 12)); utf8[1] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[2] = (char)(0x80 | (w & 0x3F)); utf8[3] = 0; }
                else { utf8[0] = (char)(0xF0 | (w >> 18)); utf8[1] = (char)(0x80 | ((w >> 12) & 0x3F)); utf8[2] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[3] = (char)(0x80 | (w & 0x3F)); utf8[4] = 0; }
                ImGui::PushFont(icon_font);
                bool clicked = ImGui::Button(utf8, ImVec2(28, 28));
                ImGui::PopFont();
                ImGui::SameLine();
                ImGui::Text("U+%04X", cp);
                if (clicked) {
                    char buf[16];
                    snprintf(buf, sizeof(buf), "U+%04X", cp);
                    ImGui::SetClipboardText(buf);
                }
                if (++col >= items_in_row) { col = 0; ImGui::NewLine(); }
            }
        } else {
            ImGui::TextUnformatted("No icon font loaded.");
        }
    }
    ImGui::End();
}

} // namespace gui


