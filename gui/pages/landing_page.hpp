#pragma once

#include <string>
#include <functional>

namespace gui {

struct LandingCallbacks {
    std::function<void()> on_start_new;
    std::function<void(const std::string&)> on_resume_path;
    std::function<void(const std::string&)> on_load_path;
};

void render_landing_page(const char* last_session_path, const LandingCallbacks& cb);

}


