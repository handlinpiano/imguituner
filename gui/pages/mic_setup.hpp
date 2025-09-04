#pragma once

#include <string>
#include <vector>

namespace gui {

struct MicDeviceInfo {
    std::string name;   // e.g., plughw:CARD=...,DEV=0
    std::string desc;   // friendly
};

// Enumerate ALSA capture-capable devices (plughw/hw and default if present)
std::vector<MicDeviceInfo> list_capture_devices();

// Render setup window; returns true if user clicked Apply
bool render_mic_setup_window(std::string& selected_device, bool& open);

// Push latest audio RMS level (0..1 nominal) for the live meter
void mic_setup_push_level(float rms);

}


