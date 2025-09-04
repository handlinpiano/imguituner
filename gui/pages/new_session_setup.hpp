#pragma once

#include <functional>
#include <string>

namespace tuner { struct SessionSettings; }

namespace gui {

struct NewSessionCallbacks {
    std::function<void(const tuner::SessionSettings&)> on_confirm;
    std::function<void()> on_cancel;
};

void render_new_session_setup(tuner::SessionSettings& draft, const NewSessionCallbacks& cb);

}


