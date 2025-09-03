#pragma once

#include "app_settings.hpp"

namespace tuner {

bool load_settings(const char* path, AppSettings& st);
bool save_settings(const char* path, const AppSettings& st);

}


