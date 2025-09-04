#include "pages/landing_page.hpp"
#include <imgui.h>

namespace gui {

static bool file_picker_modal(const char* id, std::string& out_path) {
    // Minimal text input based picker (placeholder for a proper file dialog)
    bool chosen = false;
    bool open = true;
    if (ImGui::BeginPopupModal(id, &open, ImGuiWindowFlags_AlwaysAutoResize)) {
        static char path_buf[512] = {0};
        ImGui::InputText("Path", path_buf, IM_ARRAYSIZE(path_buf));
        if (ImGui::Button("OK")) {
            out_path = path_buf;
            chosen = true;
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("Cancel")) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
    return chosen;
}

void render_landing_page(const char* last_session_path, const LandingCallbacks& cb) {
    ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration |
                             ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings;
    if (ImGui::Begin("Landing", nullptr, flags)) {
        // Center content
        ImVec2 avail = ImGui::GetContentRegionAvail();
        float button_w = 320.0f, button_h = 60.0f;
        auto CenterButton = [&](const char* label) -> bool {
            float x = (avail.x - button_w) * 0.5f;
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + x);
            return ImGui::Button(label, ImVec2(button_w, button_h));
        };

        const char* title = "Piano Tuner";
        ImVec2 tsize = ImGui::CalcTextSize(title);
        float tx = (avail.x - tsize.x) * 0.5f;
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avail.y * 0.15f);
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + tx);
        ImGui::TextUnformatted(title);
        ImGui::Spacing(); ImGui::Spacing();

        if (CenterButton("Start New Tuning Session")) {
            if (cb.on_start_new) cb.on_start_new();
        }

        bool has_resume = last_session_path && last_session_path[0] != '\0';
        if (has_resume) {
            ImGui::Spacing();
            std::string resume_label = std::string("Resume ") + last_session_path;
            if (CenterButton(resume_label.c_str())) {
                if (cb.on_resume_path) cb.on_resume_path(last_session_path);
            }
        }

        ImGui::Spacing();
        static bool open_load = false;
        if (CenterButton("Load Session...")) {
            ImGui::OpenPopup("LoadSessionPopup");
            open_load = true;
        }
        std::string chosen;
        if (open_load && file_picker_modal("LoadSessionPopup", chosen)) {
            open_load = false;
            if (!chosen.empty() && cb.on_load_path) cb.on_load_path(chosen);
        }
    }
    ImGui::End();
}

}


