// Minimal, header-only command registry and command palette for ImGui
#pragma once

#include <imgui.h>
#include <functional>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>

namespace gui {

struct Command {
    std::string id;
    std::string label;
    std::string shortcut;   // e.g., "Ctrl+P" (display only)
    std::string group;      // e.g., "View", "Audio", "Help"
    std::function<bool()> is_enabled; // optional; defaults to always true
    std::function<void()> action;     // required
};

class CommandRegistry {
public:
    void register_command(const Command& cmd) {
        commands_.push_back(normalize(cmd));
    }

    // Draw main menu bar with groups: View, Audio, Help
    void draw_main_menu_bar() {
        if (ImGui::BeginMenu("View")) {
            draw_group("View");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Audio")) {
            draw_group("Audio");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Help")) {
            draw_group("Help");
            ImGui::EndMenu();
        }
    }

    // Very small set of hard-wired shortcut handlers for demo purposes
    // Call once per frame.
    void handle_shortcuts(bool allow_when_typing = false) {
        ImGuiIO& io = ImGui::GetIO();
        if (!allow_when_typing && (ImGui::IsAnyItemActive() || io.WantTextInput)) {
            return;
        }

        const bool ctrl = (io.KeyMods & ImGuiMod_Ctrl) != 0;
        // Ctrl+P => command palette
        if (ctrl && ImGui::IsKeyPressed(ImGuiKey_P, false)) {
            palette_open_ = true;
        }
        // Ctrl+1
        if (ctrl && ImGui::IsKeyPressed(ImGuiKey_1, false)) {
            trigger_by_id("view.spectrum");
        }
        // Ctrl+2
        if (ctrl && ImGui::IsKeyPressed(ImGuiKey_2, false)) {
            trigger_by_id("view.waterfall");
        }
        // Ctrl+3
        if (ctrl && ImGui::IsKeyPressed(ImGuiKey_3, false)) {
            trigger_by_id("view.concentric");
        }
        // Ctrl+Shift+1/2/3: toggle without disabling others
        const bool shift = (io.KeyMods & ImGuiMod_Shift) != 0;
        if (ctrl && shift && ImGui::IsKeyPressed(ImGuiKey_1, false)) trigger_by_id("view.toggle_spectrum");
        if (ctrl && shift && ImGui::IsKeyPressed(ImGuiKey_2, false)) trigger_by_id("view.toggle_waterfall");
        if (ctrl && shift && ImGui::IsKeyPressed(ImGuiKey_3, false)) trigger_by_id("view.toggle_concentric");
    }

    void open_palette() { palette_open_ = true; }
    void close_palette() { palette_open_ = false; palette_query_.clear(); }
    bool is_palette_open() const { return palette_open_; }

    // Call each frame; renders when palette is open
    void render_command_palette(const char* title = "Command Palette") {
        if (!palette_open_) return;
        ImGui::SetNextWindowSize(ImVec2(520, 380), ImGuiCond_FirstUseEver);
        if (ImGui::Begin(title, &palette_open_, 0)) {
            ImGui::TextUnformatted("Type to search commands, Enter to run");
            ImGui::Spacing();
            ImGui::PushItemWidth(-1.0f);
            if (ImGui::InputTextWithHint("##cmd_query", "Search...", palette_buf_, sizeof(palette_buf_))) {
                palette_query_ = palette_buf_;
            }
            ImGui::PopItemWidth();
            ImGui::Separator();

            if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
                close_palette();
            }

            // List matching commands
            ImGui::BeginChild("##cmd_list", ImVec2(0, 0), false, ImGuiWindowFlags_NavFlattened);
            int idx = 0;
            for (const auto& cmd : commands_) {
                if (cmd.group == "") continue;
                if (!cmd.is_enabled || cmd.is_enabled()) {
                    if (matches_query(cmd)) {
                        bool selected = (idx == selected_index_);
                        if (ImGui::Selectable((cmd.label + shortcut_suffix(cmd.shortcut)).c_str(), selected)) {
                            if (cmd.action) cmd.action();
                            close_palette();
                            break;
                        }
                        ++idx;
                    }
                }
            }
            ImGui::EndChild();

            // Enter selects first visible command
            if (ImGui::IsKeyPressed(ImGuiKey_Enter)) {
                for (const auto& cmd : commands_) {
                    if (!cmd.is_enabled || cmd.is_enabled()) {
                        if (matches_query(cmd)) {
                            if (cmd.action) cmd.action();
                            close_palette();
                            break;
                        }
                    }
                }
            }
        }
        ImGui::End();
    }

    // Utility to fire a command by id
    void trigger_by_id(const std::string& id) {
        for (const auto& c : commands_) {
            if (c.id == id) {
                if (!c.is_enabled || c.is_enabled()) {
                    if (c.action) c.action();
                }
                return;
            }
        }
    }

private:
    std::vector<Command> commands_;
    bool palette_open_ = false;
    std::string palette_query_;
    int selected_index_ = 0;
    char palette_buf_[256] = {};

    static Command normalize(const Command& in) {
        Command c = in;
        if (!c.is_enabled) c.is_enabled = [] { return true; };
        return c;
    }

    static std::string shortcut_suffix(const std::string& sc) {
        if (sc.empty()) return std::string();
        return std::string("\t") + sc;
    }

    void draw_group(const char* group) {
        for (const auto& c : commands_) {
            if (c.group == group) {
                bool enabled = !c.is_enabled || c.is_enabled();
                if (!enabled) ImGui::BeginDisabled();
                if (ImGui::MenuItem(c.label.c_str(), c.shortcut.empty() ? nullptr : c.shortcut.c_str())) {
                    if (enabled && c.action) c.action();
                }
                if (!enabled) ImGui::EndDisabled();
            }
        }
    }

    bool matches_query(const Command& c) const {
        if (palette_query_.empty()) return true;
        std::string q = to_lower(palette_query_);
        return contains(to_lower(c.label), q) || contains(to_lower(c.group), q) || contains(to_lower(c.id), q);
    }

    static std::string to_lower(std::string s) {
        std::transform(s.begin(), s.end(), s.begin(), [](unsigned char ch){ return (char)std::tolower(ch); });
        return s;
    }

    static bool contains(const std::string& hay, const std::string& needle) {
        return hay.find(needle) != std::string::npos;
    }
};

} // namespace gui


