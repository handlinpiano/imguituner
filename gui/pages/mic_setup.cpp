#include "pages/mic_setup.hpp"
#include <imgui.h>
#include <alsa/asoundlib.h>
#include <cstring>

namespace gui {

static float g_last_rms = 0.0f;
void mic_setup_push_level(float rms) { g_last_rms = rms; }

std::vector<MicDeviceInfo> list_capture_devices() {
    std::vector<MicDeviceInfo> out;

    void** hints = nullptr;
    if (snd_device_name_hint(-1, "pcm", &hints) == 0 && hints) {
        for (void** n = hints; *n != nullptr; ++n) {
            const char* name = snd_device_name_get_hint(*n, "NAME");
            const char* ioid = snd_device_name_get_hint(*n, "IOID");
            const char* desc = snd_device_name_get_hint(*n, "DESC");
            if (!name) continue;
            if (ioid && std::strcmp(ioid, "Input") != 0) continue;
            std::string s(name);
            if (s.rfind("hw:", 0) == 0) {
                MicDeviceInfo d; d.name = s; d.desc = desc ? desc : ""; out.push_back(d);
            }
        }
        snd_device_name_free_hint(hints);
    }
    return out;
}

bool render_mic_setup_window(std::string& selected_device, bool& open) {
    bool applied = false;
    if (!open) return false;
    if (ImGui::Begin("Microphone Setup", &open)) {
        static std::vector<MicDeviceInfo> devices;
        static int selected_idx = -1;
        if (devices.empty()) {
            devices = list_capture_devices();
            // Find current selection
            selected_idx = 0;
            for (int i = 0; i < (int)devices.size(); ++i) {
                if (devices[i].name == selected_device) { selected_idx = i; break; }
            }
        }

        if (ImGui::Button("Refresh")) {
            devices = list_capture_devices();
            selected_idx = 0;
            for (int i = 0; i < (int)devices.size(); ++i) {
                if (devices[i].name == selected_device) { selected_idx = i; break; }
            }
        }
        ImGui::Separator();

        if (ImGui::BeginListBox("##mic_devices", ImVec2(-FLT_MIN, 200))) {
            for (int i = 0; i < (int)devices.size(); ++i) {
                const bool is_selected = (i == selected_idx);
                if (ImGui::Selectable(devices[i].name.c_str(), is_selected)) {
                    selected_idx = i;
                }
                if (is_selected) ImGui::SetItemDefaultFocus();
            }
            ImGui::EndListBox();
        }

        if (selected_idx >= 0 && selected_idx < (int)devices.size()) {
            ImGui::TextWrapped("%s", devices[selected_idx].desc.c_str());
        }
        ImGui::Separator();
        if (ImGui::Button("Apply & Restart Audio")) {
            if (selected_idx >= 0 && selected_idx < (int)devices.size()) {
                selected_device = devices[selected_idx].name;
                applied = true;
            }
        }
        ImGui::SameLine();
        if (ImGui::Button("Close")) open = false;

        ImGui::Separator();
        // Simple level meter
        ImGui::TextUnformatted("Input level:");
        float level = g_last_rms; if (level < 0) level = 0; if (level > 1) level = 1;
        ImVec2 avail = ImGui::GetContentRegionAvail();
        ImVec2 barSize(avail.x, 16.0f);
        ImGui::ProgressBar(level, barSize);
    }
    ImGui::End();
    return applied;
}

}


