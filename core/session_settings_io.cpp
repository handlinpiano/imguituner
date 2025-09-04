#include "session_settings.hpp"
#include <cstdio>
#include <cstring>
#include <string>

namespace tuner {

static void write_json_string(FILE* f, const std::string& s) {
    // naive: assuming s has no embedded quotes needing escaping in our context
    std::fprintf(f, "%s", s.c_str());
}

bool load_session_settings(const char* path, SessionSettings& out) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long sz = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (sz <= 0 || sz > (1<<20)) { std::fclose(f); return false; }
    std::string buf; buf.resize((size_t)sz);
    size_t n = std::fread(buf.data(), 1, (size_t)sz, f);
    std::fclose(f);
    if (n != (size_t)sz) return false;

    auto find_str_value = [&](const char* key) -> std::string {
        const char* p = std::strstr(buf.c_str(), key);
        if (!p) return std::string();
        p = std::strchr(p, ':'); if (!p) return std::string();
        ++p;
        while (*p == ' ' || *p == '\t' || *p == '"') ++p;
        const char* start = p;
        while (*p && *p != '"' && *p != '\n' && *p != '\r') ++p;
        return std::string(start, p - start);
    };
    auto find_int_value = [&](const char* key) -> int {
        const char* p = std::strstr(buf.c_str(), key);
        if (!p) return 0;
        p = std::strchr(p, ':'); if (!p) return 0; ++p;
        return (int)std::strtol(p, nullptr, 10);
    };

    out.name = find_str_value("\"name\"");
    out.path = path;
    out.created_utc = find_str_value("\"created_utc\"");
    out.modified_utc = find_str_value("\"modified_utc\"");
    out.piano_model = find_str_value("\"piano_model\"");
    out.technician = find_str_value("\"technician\"");
    out.reference_a_hz = find_int_value("\"reference_a_hz\"");
    out.temperament = find_str_value("\"temperament\"");
    out.instrument_type = find_str_value("\"instrument_type\"");
    {
        const char* p = std::strstr(buf.c_str(), "\"a4_offset_cents\"");
        if (p) { p = std::strchr(p, ':'); if (p) { ++p; out.a4_offset_cents = (float)std::strtod(p, nullptr); } }
    }
    {
        const char* p = std::strstr(buf.c_str(), "\"size_feet\"");
        if (p) { p = std::strchr(p, ':'); if (p) { ++p; out.size_feet = (float)std::strtod(p, nullptr); } }
    }
    {
        const char* p = std::strstr(buf.c_str(), "\"upright_height_inches\"");
        if (p) { p = std::strchr(p, ':'); if (p) { ++p; out.upright_height_inches = (float)std::strtod(p, nullptr); } }
    }
    if (out.reference_a_hz <= 0) out.reference_a_hz = 440;
    return true;
}

bool save_session_settings(const char* path, const SessionSettings& in) {
    FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    std::fprintf(f,
        "{\n"
        "  \"name\": \""); write_json_string(f, in.name); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"created_utc\": \""); write_json_string(f, in.created_utc); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"modified_utc\": \""); write_json_string(f, in.modified_utc); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"piano_model\": \""); write_json_string(f, in.piano_model); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"technician\": \""); write_json_string(f, in.technician); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"reference_a_hz\": %d,\n", in.reference_a_hz);
    std::fprintf(f, "  \"temperament\": \""); write_json_string(f, in.temperament); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"instrument_type\": \""); write_json_string(f, in.instrument_type); std::fprintf(f, "\",\n");
    std::fprintf(f, "  \"a4_offset_cents\": %.2f,\n", in.a4_offset_cents);
    std::fprintf(f, "  \"size_feet\": %.2f,\n", in.size_feet);
    std::fprintf(f, "  \"upright_height_inches\": %.2f\n", in.upright_height_inches);
    std::fprintf(f, "}\n");
    std::fclose(f);
    return true;
}

} // namespace tuner


