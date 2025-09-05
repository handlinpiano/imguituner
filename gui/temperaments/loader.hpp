#pragma once

#include <string>
#include <vector>

namespace gui { namespace temperaments {

// Returns a list of available temperaments by display name.
// It scans the directory at `dir_path` (default: "temperaments") for .json files.
std::vector<std::string> list_temperaments(const std::string& dir_path = "temperaments");

}}


