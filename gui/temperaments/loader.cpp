#include "temperaments/loader.hpp"
#include <filesystem>
#include <fstream>
#include <algorithm>

namespace fs = std::filesystem;

namespace gui { namespace temperaments {

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\n\r");
    size_t b = s.find_last_not_of(" \t\n\r");
    if (a == std::string::npos) return std::string();
    return s.substr(a, b - a + 1);
}

static std::string derive_display_name_from_filename(const std::string& stem) {
    std::string name = stem;
    for (char& c : name) { if (c == '_' || c == '-') c = ' '; }
    // Capitalize first letters
    bool cap = true;
    for (char& c : name) {
        if (cap && c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
        cap = (c == ' ');
    }
    return name;
}

static std::string try_extract_name_field(const fs::path& p) {
    std::ifstream f(p);
    if (!f) return std::string();
    std::string content((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    auto pos = content.find("\"name\"");
    if (pos == std::string::npos) return std::string();
    pos = content.find(':', pos);
    if (pos == std::string::npos) return std::string();
    pos++;
    // find first quote
    pos = content.find('"', pos);
    if (pos == std::string::npos) return std::string();
    size_t end = content.find('"', pos + 1);
    if (end == std::string::npos) return std::string();
    return trim(content.substr(pos + 1, end - pos - 1));
}

std::vector<std::string> list_temperaments(const std::string& dir_path) {
    std::vector<std::string> out;
    try {
        if (!fs::exists(dir_path)) {
            return {"Equal Temperament"};
        }
        for (auto& entry : fs::directory_iterator(dir_path)) {
            if (!entry.is_regular_file()) continue;
            auto p = entry.path();
            auto ext = p.extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c){ return (char)std::tolower(c); });
            if (ext == ".json") {
                std::string name = try_extract_name_field(p);
                if (name.empty()) name = derive_display_name_from_filename(p.stem().string());
                if (!name.empty()) out.push_back(name);
            }
        }
    } catch (...) {
        // ignore errors and fall back
    }
    if (out.empty()) out.push_back("Equal Temperament");
    // Stable sort for deterministic order
    std::sort(out.begin(), out.end());
    return out;
}

}} // namespace gui::temperaments


