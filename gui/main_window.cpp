#include "audio_input.hpp"
#include <iostream>
#include <vector>
#include <complex>
#include <cmath>
#include <algorithm>
#include <array>
#include <deque>
#include <memory>
#include <unordered_map>
#include <tuple>
#include "plots/spectrum_plot.hpp"
#include "plots/waterfall_plot.hpp"
#include "settings_page.hpp"
#include "app_settings.hpp"
#include "app_settings_io.hpp"
#include "zoom_fft.hpp"
#include "fft/fft_utils.hpp"
#include "plots/concentric_plot.hpp"

// ImGui + OpenGL ES 3 (Pi 4)
#include <GLES3/gl3.h>
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <fstream>
#include "command_registry.hpp"

using namespace tuner;

// GUI uses core ZoomFFT; no DSP here

class TunerGUI {
public:
    TunerGUI() : center_frequency(440.0f) {
        
        // Setup audio
        audio_config.device_name = "hw:1,0";
        audio_config.sample_rate = 48000;
        audio_config.period_size = 64; // lower latency callbacks
        
        // Default zoom parameters are configured in cfg_core when processing

        audio_input = createAudioInput(audio_config);
        audio_input->set_process_callback([this](const float* input, int num_samples) {
            this->process_audio(input, num_samples);
        });
    }
    
    bool init_gui() {
        // Initialize GLFW
        if (!glfwInit()) return false;
        
        // Request OpenGL ES 3.0 context via EGL
        glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
        
        window = glfwCreateWindow(1200, 800, "Piano Tuner - Zoom FFT", nullptr, nullptr);
        if (!window) {
            glfwTerminate();
            return false;
        }
        
        glfwMakeContextCurrent(window);
        glfwSwapInterval(1); // Enable vsync
        
        // Setup ImGui
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO(); (void)io;
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        
        ImGui::StyleColorsDark();

        // Load fonts (Roboto + optional Material Design Icons)
        auto file_exists = [](const char* path) -> bool {
            std::ifstream f(path, std::ios::binary); return (bool)f;
        };

        const char* roboto_paths[] = {
            "/usr/share/fonts/truetype/roboto/Roboto-Regular.ttf",
            "/usr/share/fonts/truetype/roboto/hinted/Roboto-Regular.ttf",
            "/usr/share/fonts/truetype/google/Roboto-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", // fallback
        };
        const char* roboto_used = nullptr;
        for (const char* p : roboto_paths) { if (file_exists(p)) { roboto_used = p; break; } }
        if (roboto_used) {
            io.Fonts->AddFontFromFileTTF(roboto_used, 18.0f);
        } else {
            // Default font if nothing found
            io.Fonts->AddFontDefault();
        }

        // Optional: merge Material Design Icons from third_party/icons if present
        const char* mdi_paths[] = {
            "third_party/icons/MaterialIcons-Regular.ttf",
            "third_party/icons/materialdesignicons.ttf",
            "third_party/icons/MaterialDesignIconsDesktop.ttf",
        };
        const char* mdi_path = nullptr;
        for (const char* p : mdi_paths) { if (file_exists(p)) { mdi_path = p; break; } }
        if (mdi_path) {
            ImFontConfig cfg; cfg.MergeMode = true; cfg.GlyphMinAdvanceX = 18.0f; cfg.GlyphOffset = ImVec2(0.0f, 2.0f);
            static const ImWchar mdi_range[] = { 0xE000, 0xF8FF, 0 };
            io.Fonts->AddFontFromFileTTF(mdi_path, 18.0f, &cfg, mdi_range);
        }
        
        ImGui_ImplGlfw_InitForOpenGL(window, true);
        // Use GLSL ES 3.0 shader version for OpenGL ES
        ImGui_ImplOpenGL3_Init("#version 300 es");

        // Load settings (ignore errors)
        load_settings(settings_path, settings);
        center_frequency = settings.center_frequency_hz;
        precise_fft_size = settings.precise_fft_size;
        precise_decimation = settings.precise_decimation;
        precise_window_seconds = settings.precise_window_seconds;
        // frontend_decimation removed (fixed at 1)
        spectrum_view.show_frequency_lines = settings.show_frequency_lines;
        spectrum_view.show_peak_line = settings.show_peak_line;
        spectrum_view.bell_curve_width = settings.bell_curve_width;
        spectrum_view.color_scheme_idx = settings.color_scheme_idx;
        waterfall_view.color_scheme_idx = settings.waterfall_color_scheme_idx;
        concentric_view.color_scheme_idx = settings.concentric_color_scheme_idx;
        
        // Set UI mode based on settings (no docking API required)
        ui_mode = settings.ui_mode; // 0: Desktop, 1: Kiosk Landscape, 2: Kiosk Portrait
        
        // Register commands
        build_commands();
        
        return true;
    }
    
    void run() {
        if (!init_gui()) return;
        
        if (!audio_input->start()) {
            std::cerr << "Failed to start audio\n";
            return;
        }
        
        while (!glfwWindowShouldClose(window)) {
            glfwPollEvents();
            
            // Start ImGui frame
            ImGui_ImplOpenGL3_NewFrame();
            ImGui_ImplGlfw_NewFrame();
            ImGui::NewFrame();
            
            // Global shortcuts
            command_registry.handle_shortcuts(false);
            
            // Render GUI
            render_gui();
            
            // Rendering
            ImGui::Render();
            int display_w, display_h;
            glfwGetFramebufferSize(window, &display_w, &display_h);
            glViewport(0, 0, display_w, display_h);
            glClearColor(0.1f, 0.1f, 0.1f, 1.0f);
            glClear(GL_COLOR_BUFFER_BIT);
            ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
            
            glfwSwapBuffers(window);
        }
        
        // Persist settings then cleanup
        settings.center_frequency_hz = center_frequency;
        settings.precise_fft_size = precise_fft_size;
        settings.precise_decimation = precise_decimation;
        settings.precise_window_seconds = precise_window_seconds;
        // frontend_decimation removed (fixed at 1)
        settings.show_frequency_lines = spectrum_view.show_frequency_lines;
        settings.show_peak_line = spectrum_view.show_peak_line;
        settings.bell_curve_width = spectrum_view.bell_curve_width;
        settings.color_scheme_idx = spectrum_view.color_scheme_idx;
        settings.waterfall_color_scheme_idx = waterfall_view.color_scheme_idx;
        settings.concentric_color_scheme_idx = concentric_view.color_scheme_idx;
        settings.ui_mode = ui_mode;
        save_settings(settings_path, settings);

        // Cleanup
        audio_input->stop();
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();
        glfwDestroyWindow(window);
        glfwTerminate();
    }
    
private:
    GLFWwindow* window = nullptr;
    float center_frequency;
    // legacy zoom_config removed; using core ZoomFFTConfig on demand
    AudioConfig audio_config;
    std::unique_ptr<IAudioInput> audio_input;
    int frontend_decimation = 1; // fixed at no decimation
    std::deque<float> input_ring;
    unsigned int last_actual_fs = 0;
    unsigned int last_effective_fs = 0;
    int last_window_samples = 0;
    int last_nz = 0;
    // Precise mode controls (runtime adjustable)
    int precise_fft_size = 16384;
    int precise_decimation = 16;
    float precise_window_seconds = 0.35f; // cap precise input to ~350 ms for responsiveness
    int precise_fft_idx = 3;  // 0:2048, 1:4096, 2:8192, 3:16384
    int last_required_samples = 0;
    int last_use_fft_size = 0;
    int last_use_decimation = 0;
    
    // Display data
    std::vector<float> current_spectrum;
    gui::WaterfallView waterfall_view;
    gui::ConcentricView concentric_view;
    
    float peak_frequency = 440.0f;
    float peak_magnitude = 0.0f;
    int frames_processed = 0;
    float last_rms = 0.0f;
    gui::SpectrumView spectrum_view; // owns its own options
    gui::SettingsPage settings_page;
    tuner::AppSettings settings;
    const char* settings_path = "config/settings.json";
    bool show_icon_browser = false;
    bool mic_enabled = true;
    bool show_spectrum = true;
    bool show_waterfall = false;
    bool show_concentric = false;
    bool show_spectrum_settings = false;
    bool show_waterfall_settings = false;
    bool show_concentric_settings = false;
    int ui_mode = 0; // 0: Desktop, 1: Kiosk Landscape, 2: Kiosk Portrait
    // Waterfall speed control: update one row every N audio frames (1 = fastest)
    int waterfall_stride = 1;
    int waterfall_counter = 0;
    
    bool show_settings_page = false;
    gui::CommandRegistry command_registry;


    // Map normalized x in [0,1] through fisheye transform (matches TS shader behavior)
    static float fisheye_transform(float x01, float distortion) {
        float normalizedX = (x01 - 0.5f) * 2.0f; // [-1,1]
        float transformed = 0.0f;
        float absx = std::fabs(normalizedX);
        if (distortion > 0.0f) {
            transformed = (normalizedX >= 0.0f ? absx : -absx) / (1.0f + absx * distortion);
            transformed = transformed * (1.0f + distortion);
        } else {
            transformed = normalizedX;
        }
        return transformed * 0.5f + 0.5f; // back to [0,1]
    }
    
    void process_audio(const float* input, int num_samples) {
        // Track actual sample rate and reflect front-end decimation
        const unsigned int actual_fs = audio_input->get_config().sample_rate;
        const unsigned int effective_fs = actual_fs; // no frontend decimation
        // sample rate for core zoom fft is set when constructing cfg_core
        last_actual_fs = actual_fs;
        last_effective_fs = effective_fs;

        // Append front-end decimated samples to ring buffer
        if (input && num_samples > 0) {
            for (int i = 0; i < num_samples; ++i) {
                input_ring.push_back(input[i]);
            }
        }

        // Ensure ring buffer holds at most the window needed for a full Zoom FFT
        // Maintain ring buffer up to the precise time-capped window requirement
        const int precise_required_samples = precise_fft_size * std::max(1, precise_decimation);
        const int precise_time_capped = std::min(precise_required_samples, static_cast<int>(last_effective_fs * precise_window_seconds));
        while (static_cast<int>(input_ring.size()) > precise_time_capped) {
            input_ring.pop_front();
        }

        // Build contiguous input window
        std::vector<float> windowed_input;
        windowed_input.reserve(input_ring.size());
        for (float s : input_ring) windowed_input.push_back(s);
        last_window_samples = static_cast<int>(windowed_input.size());

        // Precise-only processing path using core ZoomFFT
        std::vector<float> magnitudes;
        int use_fft_size = precise_fft_size;
        int use_decimation = precise_decimation;
        int required_input_samples = precise_time_capped;

        last_required_samples = required_input_samples;
        last_use_fft_size = use_fft_size;
        last_use_decimation = use_decimation;

        // Build processing window (take latest required_input_samples from ring)
        std::vector<float> proc_input;
        if (required_input_samples > 0) {
            int take = std::min(required_input_samples, static_cast<int>(input_ring.size()));
            proc_input.reserve(take);
            auto it = input_ring.end();
            for (int i = 0; i < take; ++i) {
                --it;
                proc_input.push_back(*it);
            }
            std::reverse(proc_input.begin(), proc_input.end());
        }

        // Configure core ZoomFFT
        tuner::ZoomFFTConfig cfg_core;
        cfg_core.decimation = use_decimation;
        cfg_core.fft_size = use_fft_size;
        cfg_core.num_bins = 1200; // match previous default
        cfg_core.sample_rate = static_cast<int>(last_effective_fs);
        cfg_core.use_hann = true;
        static std::unique_ptr<tuner::ZoomFFT> zoomfft;
        static int last_fft_size_used = 0, last_decim_used = 0, last_sr_used = 0;
        if (!zoomfft || last_fft_size_used != cfg_core.fft_size || last_decim_used != cfg_core.decimation || last_sr_used != cfg_core.sample_rate) {
            zoomfft = std::make_unique<tuner::ZoomFFT>(cfg_core);
            last_fft_size_used = cfg_core.fft_size;
            last_decim_used = cfg_core.decimation;
            last_sr_used = cfg_core.sample_rate;
        }

        // Expected decimated output length Nz
        last_nz = std::min(use_fft_size, static_cast<int>(proc_input.size()) / std::max(1, use_decimation));
        
        // Compute RMS on latest raw chunk for sanity
        if (input && num_samples > 0) {
            double acc = 0.0;
            int count = 0;
            for (int i = 0; i < num_samples; i += std::max(1, frontend_decimation)) {
                float v = input[i];
                acc += static_cast<double>(v) * static_cast<double>(v);
                ++count;
            }
            last_rms = count > 0 ? std::sqrt(acc / static_cast<double>(count)) : 0.0f;
        }

        // If not enough data even for fast path, fall back to current decimated chunk
        if (last_nz <= 8) {
            std::vector<float> chunk_decimated;
            chunk_decimated.reserve(static_cast<size_t>(num_samples / std::max(1, frontend_decimation)) + 1);
            for (int i = 0; i < num_samples; i += std::max(1, frontend_decimation)) {
                chunk_decimated.push_back(input[i]);
            }
            magnitudes = zoomfft->process(chunk_decimated.data(), (int)chunk_decimated.size(), center_frequency);
        } else {
            magnitudes = zoomfft->process(proc_input.data(), (int)proc_input.size(), center_frequency);
        }
        
        // Thread-safe update
        current_spectrum = magnitudes;
        
        // Find peak
        float max_mag = 0.0f;
        int peak_bin = 0;
        for (size_t i = 0; i < magnitudes.size(); ++i) {
            if (magnitudes[i] > max_mag) {
                max_mag = magnitudes[i];
                peak_bin = static_cast<int>(i);
            }
        }
        
        // Convert bin to frequency
        float cents = -120.0f + 240.0f * (static_cast<float>(peak_bin) / (1200 - 1));
        peak_frequency = center_frequency * std::pow(2.0f, cents / 1200.0f);
        peak_magnitude = max_mag;
        frames_processed++;
        
        // Update waterfall according to speed control
        if (++waterfall_counter >= std::max(1, waterfall_stride)) {
            waterfall_counter = 0;
            waterfall_view.update(magnitudes);
        }
    }
    
    void render_gui() {
        // Main menu bar
        if (ImGui::BeginMainMenuBar()) {
            command_registry.draw_main_menu_bar();
            if (ImGui::BeginMenu("Mode")) {
                bool desktop = (ui_mode == 0);
                if (ImGui::MenuItem("Desktop (Docking)", nullptr, desktop)) {
                    ui_mode = 0;
                }
                bool kiosk_land = (ui_mode == 1);
                if (ImGui::MenuItem("Kiosk - Landscape", nullptr, kiosk_land)) {
                    ui_mode = 1;
                }
                bool kiosk_port = (ui_mode == 2);
                if (ImGui::MenuItem("Kiosk - Portrait", nullptr, kiosk_port)) {
                    ui_mode = 2;
                }
                ImGui::EndMenu();
            }
            ImGui::EndMainMenuBar();
        }
        
        // Desktop mode: separate windows (no docking required)
        if (ui_mode == 0) {
            // Views
            if (show_spectrum) {
                if (ImGui::Begin("Spectrum", nullptr, ImGuiWindowFlags_MenuBar)) {
                    if (ImGui::BeginMenuBar()) {
                        if (ImGui::BeginMenu("Settings")) {
                            bool open = show_spectrum_settings;
                            if (ImGui::MenuItem("Spectrum Settings", nullptr, open)) {
                                show_spectrum_settings = !show_spectrum_settings;
                            }
                            ImGui::EndMenu();
                        }
                        ImGui::EndMenuBar();
                    }
                    if (!current_spectrum.empty()) {
                        ImDrawList* dl = ImGui::GetWindowDrawList();
                        ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                        ImVec2 m_av = ImGui::GetContentRegionAvail();
                        const float width = std::max(200.0f, m_av.x);
                        const float height = std::max(120.0f, m_av.y);
                        spectrum_view.draw(dl, canvas_pos, width, height, current_spectrum, center_frequency, peak_frequency, peak_magnitude);
                    }
                    if (show_spectrum_settings) {
                        // Opaque background child for readability over spectrum
                        ImGui::Separator();
                        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.06f, 0.06f, 0.07f, 0.95f));
                        ImGui::BeginChild("SpectrumSettingsPanel", ImVec2(0, 0), true);
                        ImGui::TextUnformatted("Spectrum Settings");
                        ImGui::Checkbox("Show frequency lines", &spectrum_view.show_frequency_lines);
                        ImGui::SameLine();
                        ImGui::Checkbox("Show peak line", &spectrum_view.show_peak_line);
                        ImGui::SliderFloat("Fisheye (bell)", &spectrum_view.bell_curve_width, 0.0f, 2.0f, "%.2f");
                        ImGui::Separator();
                        ImGui::Checkbox("Target frequency line", &spectrum_view.show_target_line);
                        ImGui::Checkbox("10 cent lines", &spectrum_view.show_10_cent_lines);
                        ImGui::Checkbox("20 cent lines", &spectrum_view.show_20_cent_lines);
                        ImGui::Checkbox("1 cent lines", &spectrum_view.show_1_cent_lines);
                        ImGui::Checkbox("2 cent lines", &spectrum_view.show_2_cent_lines);
                        ImGui::Checkbox("5 cent lines", &spectrum_view.show_5_cent_lines);
                        ImGui::ColorEdit4("Target color", (float*)&spectrum_view.color_target, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("10-cent color", (float*)&spectrum_view.color_10_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("20-cent color", (float*)&spectrum_view.color_20_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("1-cent color", (float*)&spectrum_view.color_1_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("2-cent color", (float*)&spectrum_view.color_2_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("5-cent color", (float*)&spectrum_view.color_5_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::Separator();
                        ImGui::Checkbox("Show X-axis cent labels", &spectrum_view.show_cent_labels);
                        ImGui::SliderInt("Label size", &spectrum_view.cent_label_size, 0, 3);
                        ImGui::ColorEdit4("Label color", (float*)&spectrum_view.color_cent_labels, ImGuiColorEditFlags_NoInputs);
                        const auto& schemes_local = spectrum_view.schemes();
                        int idx_local = spectrum_view.color_scheme_idx;
                        if (ImGui::BeginCombo("Color scheme##spectrum_window", schemes_local[idx_local].name)) {
                            for (int i = 0; i < (int)schemes_local.size(); ++i) {
                                bool selected = (i == idx_local);
                                if (ImGui::Selectable(schemes_local[i].name, selected)) { idx_local = i; spectrum_view.color_scheme_idx = i; }
                                if (selected) ImGui::SetItemDefaultFocus();
                            }
                            ImGui::EndCombo();
                        }
                        ImGui::EndChild();
                        ImGui::PopStyleColor();
                    }
                }
                ImGui::End();
            }
            if (show_waterfall) {
                if (ImGui::Begin("Waterfall", nullptr, ImGuiWindowFlags_MenuBar)) {
                    if (ImGui::BeginMenuBar()) {
                        if (ImGui::BeginMenu("Settings")) {
                            bool open = show_waterfall_settings;
                            if (ImGui::MenuItem("Waterfall Settings", nullptr, open)) {
                                show_waterfall_settings = !show_waterfall_settings;
                            }
                            ImGui::EndMenu();
                        }
                        ImGui::EndMenuBar();
                    }
                    ImDrawList* draw_list = ImGui::GetWindowDrawList();
                    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                    ImVec2 m_av = ImGui::GetContentRegionAvail();
                    const float width = m_av.x;
                    const float height = m_av.y;
                    waterfall_view.draw(draw_list, canvas_pos, width, height, spectrum_view);
                    if (show_waterfall_settings) {
                        ImGui::Separator();
                        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.06f, 0.06f, 0.07f, 0.95f));
                        ImGui::BeginChild("WaterfallSettingsPanel", ImVec2(0, 0), true);
                        ImGui::TextUnformatted("Waterfall Settings");
                        // Color scheme dropdown using Spectrum palettes
                        const auto& schemes_wf = spectrum_view.schemes();
                        int widx_local = waterfall_view.color_scheme_idx;
                        const char* preview = schemes_wf[std::max(0, std::min((int)schemes_wf.size()-1, widx_local))].name;
                        if (ImGui::BeginCombo("Color scheme##waterfall_window", preview)) {
                            for (int i = 0; i < (int)schemes_wf.size(); ++i) {
                                bool selected = (i == widx_local);
                                if (ImGui::Selectable(schemes_wf[i].name, selected)) { widx_local = i; waterfall_view.color_scheme_idx = i; }
                                if (selected) ImGui::SetItemDefaultFocus();
                            }
                            ImGui::EndCombo();
                        }
                        // Independent line overlays
                        ImGui::Separator();
                        ImGui::Checkbox("Target frequency line", &waterfall_view.show_target_line);
                        ImGui::Checkbox("10 cent lines", &waterfall_view.show_10_cent_lines);
                        ImGui::Checkbox("20 cent lines", &waterfall_view.show_20_cent_lines);
                        ImGui::Checkbox("1 cent lines", &waterfall_view.show_1_cent_lines);
                        ImGui::Checkbox("2 cent lines", &waterfall_view.show_2_cent_lines);
                        ImGui::Checkbox("5 cent lines", &waterfall_view.show_5_cent_lines);
                        ImGui::ColorEdit4("Target color", (float*)&waterfall_view.color_target, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("10-cent color", (float*)&waterfall_view.color_10_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("20-cent color", (float*)&waterfall_view.color_20_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("1-cent color", (float*)&waterfall_view.color_1_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("2-cent color", (float*)&waterfall_view.color_2_cent, ImGuiColorEditFlags_NoInputs);
                        ImGui::ColorEdit4("5-cent color", (float*)&waterfall_view.color_5_cent, ImGuiColorEditFlags_NoInputs);
                        // Speed (stride)
                        ImGui::SliderInt("Waterfall Stride (1=fast)", &waterfall_stride, 1, 20);
                        ImGui::SameLine();
                        ImGui::Text("x%.1f", 1.0f / (float)std::max(1, waterfall_stride));
                        ImGui::EndChild();
                        ImGui::PopStyleColor();
                    }
                }
                ImGui::End();
            }
            if (show_concentric) {
                if (ImGui::Begin("Concentric", nullptr, ImGuiWindowFlags_MenuBar)) {
                    if (ImGui::BeginMenuBar()) {
                        if (ImGui::BeginMenu("Settings")) {
                            bool open = show_concentric_settings;
                            if (ImGui::MenuItem("Concentric Settings", nullptr, open)) {
                                show_concentric_settings = !show_concentric_settings;
                            }
                            ImGui::EndMenu();
                        }
                        ImGui::EndMenuBar();
                    }
                    ImDrawList* dl = ImGui::GetWindowDrawList();
                    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                    ImVec2 m_av = ImGui::GetContentRegionAvail();
                    const float width = std::max(200.0f, m_av.x);
                    const float height = std::max(120.0f, m_av.y);
                    concentric_view.draw(dl, canvas_pos, width, height, center_frequency, peak_frequency, peak_magnitude);
                    if (show_concentric_settings) {
                        ImGui::Separator();
                        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.06f, 0.06f, 0.07f, 0.95f));
                        ImGui::BeginChild("ConcentricSettingsPanel", ImVec2(0, 0), true);
                        ImGui::TextUnformatted("Concentric Settings");
                        ImGui::Checkbox("Lock-in enabled", &concentric_view.lock_in_enabled);
                        ImGui::SliderFloat("Fisheye (bell)", &concentric_view.fisheye_distortion, 0.0f, 2.0f, "%.2f");
                        auto& circles = concentric_view.circles();
                        for (size_t i = 0; i < circles.size(); ++i) {
                            char label[32]; snprintf(label, sizeof(label), "Circle %zu", i + 1);
                            if (ImGui::TreeNode(label)) {
                                ImGui::SliderFloat("Movement range (±cents)", &circles[i].movement_range_cents, 1.0f, 120.0f, "%.0f");
                                float min_tol = (i + 1 == circles.size()) ? 0.25f : 1.0f;
                                const char* fmt_tol = (i + 1 == circles.size()) ? "%.2f" : "%.0f";
                                ImGui::SliderFloat("Locking tolerance (±cents)", &circles[i].locking_tolerance_cents, min_tol, 50.0f, fmt_tol);
                                ImGui::SliderFloat("Radius (px)", &circles[i].radius_px, 6.0f, 80.0f, "%.0f");
                                // Color picker
                                ImVec4 col = ImGui::ColorConvertU32ToFloat4(circles[i].color);
                                if (ImGui::ColorEdit4("Color", (float*)&col, ImGuiColorEditFlags_NoInputs)) {
                                    circles[i].color = ImGui::ColorConvertFloat4ToU32(col);
                                }
                                ImGui::TreePop();
                            }
                        }
                        ImGui::EndChild();
                        ImGui::PopStyleColor();
                    }
                }
                ImGui::End();
            }
            // Settings in a separate window
            if (show_settings_page) {
                if (ImGui::Begin("Settings")) {
                    settings_page.render(center_frequency,
                                         precise_fft_size,
                                         precise_decimation,
                                         precise_window_seconds,
                                         frontend_decimation,
                                         spectrum_view,
                                         &waterfall_view,
                                         waterfall_stride,
                                         &concentric_view);
                }
                ImGui::End();
            }
            // Icon Browser window (optional)
            if (show_icon_browser) {
                ImGui::Begin("Icon Browser", &show_icon_browser);
                ImGui::TextUnformatted("Click a glyph to copy its codepoint (U+XXXX) to the clipboard.");
                ImGui::Separator();
                ImGuiIO& io = ImGui::GetIO();
                ImFont* icon_font = nullptr;
                if (!io.Fonts->Fonts.empty()) icon_font = io.Fonts->Fonts.back();
                if (icon_font) {
                    int items_in_row = 10;
                    int col = 0;
                    for (int cp = 0xE000; cp <= 0xF8FF; ++cp) {
                        // Encode codepoint to UTF-8 (PUA range uses 3-byte UTF-8)
                        char utf8[5] = {};
                        ImWchar w = (ImWchar)cp;
                        if (w < 0x80) { utf8[0] = (char)w; utf8[1] = 0; }
                        else if (w < 0x800) { utf8[0] = (char)(0xC0 | (w >> 6)); utf8[1] = (char)(0x80 | (w & 0x3F)); utf8[2] = 0; }
                        else if (w < 0x10000) { utf8[0] = (char)(0xE0 | (w >> 12)); utf8[1] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[2] = (char)(0x80 | (w & 0x3F)); utf8[3] = 0; }
                        else { utf8[0] = (char)(0xF0 | (w >> 18)); utf8[1] = (char)(0x80 | ((w >> 12) & 0x3F)); utf8[2] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[3] = (char)(0x80 | (w & 0x3F)); utf8[4] = 0; }
                        ImGui::PushFont(icon_font);
                        bool clicked = ImGui::Button(utf8, ImVec2(28, 28));
                        ImGui::PopFont();
                        ImGui::SameLine();
                        ImGui::Text("U+%04X", cp);
                        if (clicked) {
                            char buf[16];
                            snprintf(buf, sizeof(buf), "U+%04X", cp);
                            ImGui::SetClipboardText(buf);
                        }
                        if (++col >= items_in_row) { col = 0; ImGui::NewLine(); }
                    }
                } else {
                    ImGui::TextUnformatted("No icon font loaded.");
                }
                ImGui::End();
            }
            // Command palette
            command_registry.render_command_palette();
            return; // skip kiosk layout below
        }

        // Single-window UI (landscape/portrait tweaks)
        ImGui::Begin("Piano Tuner");
        
        ImVec2 avail = ImGui::GetContentRegionAvail();
        const float frame_h = ImGui::GetFrameHeightWithSpacing();
        const bool kiosk_portrait = (ui_mode == 2);
        
        auto draw_top_controls = [&]() {
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
            if (ImGui::Button(u8"\uE587")) show_settings_page = false; // home
            ImGui::SameLine();
            if (ImGui::Button(u8"\uE3AC")) show_settings_page = true;  // settings
            ImGui::SameLine();
            const char* mic_icon = u8"\uE31D";
            const bool mic_was_off = !mic_enabled;
            if (mic_was_off) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(90, 40, 40, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(120, 60, 60, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(140, 70, 70, 255));
            }
            if (ImGui::Button(mic_icon)) { mic_enabled = !mic_enabled; }
            if (mic_was_off) ImGui::PopStyleColor(3);
            ImGui::SameLine();
            // view buttons
            const bool spectrum_active = show_spectrum && !show_waterfall && !show_concentric;
            if (spectrum_active) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(40, 150, 90, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(60, 180, 120, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(70, 200, 140, 255));
            }
            if (ImGui::Button(u8"\uF22B")) { show_spectrum = true; show_waterfall = false; show_concentric = false; }
            if (spectrum_active) ImGui::PopStyleColor(3);
            ImGui::SameLine();
            const bool waterfall_was_on = show_waterfall;
            if (waterfall_was_on) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(40, 90, 150, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(60, 120, 180, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(70, 140, 200, 255));
            }
            if (ImGui::Button(u8"\uE176")) { show_waterfall = true; }
            if (waterfall_was_on) ImGui::PopStyleColor(3);
            ImGui::SameLine();
            const bool concentric_was_on = show_concentric;
            if (concentric_was_on) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(90, 40, 150, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(120, 60, 180, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(140, 70, 200, 255));
            }
            if (ImGui::Button(u8"\uE55C")) { show_concentric = true; }
            if (concentric_was_on) ImGui::PopStyleColor(3);
            ImGui::SameLine(); if (ImGui::Button("Icons")) show_icon_browser = !show_icon_browser;
            ImGui::PopStyleVar();
        };
        
        auto draw_center_content = [&]() {
            if (show_settings_page) {
                settings_page.render(center_frequency,
                                     precise_fft_size,
                                     precise_decimation,
                                     precise_window_seconds,
                                     frontend_decimation,
                                     spectrum_view,
                                     &waterfall_view,
                                     waterfall_stride,
                                     &concentric_view);
            } else {
                if (show_concentric) {
                    ImDrawList* dl = ImGui::GetWindowDrawList();
                    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                    ImVec2 m_av = ImGui::GetContentRegionAvail();
                    const float width = std::max(200.0f, m_av.x);
                    const float height = std::max(120.0f, m_av.y);
                    concentric_view.draw(dl, canvas_pos, width, height, center_frequency, peak_frequency, peak_magnitude);
                } else if (show_waterfall) {
                    ImDrawList* draw_list = ImGui::GetWindowDrawList();
                    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                    ImVec2 m_av = ImGui::GetContentRegionAvail();
                    const float width = m_av.x;
                    const float height = m_av.y;
                    waterfall_view.draw(draw_list, canvas_pos, width, height, spectrum_view);
                } else if (!current_spectrum.empty()) {
                    ImDrawList* dl = ImGui::GetWindowDrawList();
                    ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                    ImVec2 m_av = ImGui::GetContentRegionAvail();
                    const float width = std::max(200.0f, m_av.x);
                    const float height = std::max(120.0f, m_av.y);
                    spectrum_view.draw(dl, canvas_pos, width, height, current_spectrum, center_frequency, peak_frequency, peak_magnitude);
                }
            }
        };
        
        if (kiosk_portrait) {
            const float w_side = std::max(80.0f, frame_h * 3.0f);
            // Left bar
            ImGui::BeginChild("LeftBar", ImVec2(w_side, 0), true);
            draw_top_controls();
            ImGui::EndChild();
            ImGui::SameLine();
            // Center
            ImGui::BeginChild("CenterContent", ImVec2(std::max(0.0f, avail.x - 2*w_side), 0), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            draw_center_content();
            ImGui::EndChild();
            ImGui::SameLine();
            // Right bar: quick actions
            ImGui::BeginChild("RightBar", ImVec2(w_side, 0), true);
            if (ImGui::Button("Home")) show_settings_page = false;
            if (ImGui::Button("Settings")) show_settings_page = true;
            ImGui::Text("\n");
            ImGui::Text("[Prev]");
            ImGui::Text("[Play]");
            ImGui::EndChild();
        } else {
            // Landscape: top/bottom bars
            const float h_top = frame_h * 2.0f;
            const float h_bot = frame_h * 1.5f;
            float h_mid = std::max(0.0f, avail.y - h_top - h_bot);
            ImGui::BeginChild("TopBar", ImVec2(0, h_top), true);
            ImGui::Columns(4, nullptr, false);
            draw_top_controls();
            ImGui::Columns(1);
            ImGui::EndChild();
            ImGui::BeginChild("CenterContent", ImVec2(0, h_mid), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            draw_center_content();
            ImGui::EndChild();
            ImGui::BeginChild("BottomBar", ImVec2(0, h_bot), true);
            ImGui::Columns(4, nullptr, false);
            ImGui::Text("[Prev]");
            ImGui::NextColumn();
            ImGui::Text("[Play]");
            ImGui::NextColumn();
            if (ImGui::Button("Home")) show_settings_page = false;
            ImGui::NextColumn();
            if (ImGui::Button("Settings")) show_settings_page = true;
            ImGui::Columns(1);
            ImGui::EndChild();
        }
        
        // Optional: Icon Browser window
        if (show_icon_browser) {
            ImGui::Begin("Icon Browser", &show_icon_browser);
            ImGui::TextUnformatted("Click a glyph to copy its codepoint (U+XXXX) to the clipboard.");
            ImGui::Separator();
            ImGuiIO& io = ImGui::GetIO();
            ImFont* icon_font = nullptr;
            if (!io.Fonts->Fonts.empty()) icon_font = io.Fonts->Fonts.back();
            if (icon_font) {
                int items_in_row = 10;
                int col = 0;
                for (int cp = 0xE000; cp <= 0xF8FF; ++cp) {
                    // Encode codepoint to UTF-8 (PUA range uses 3-byte UTF-8)
                    char utf8[5] = {};
                    ImWchar w = (ImWchar)cp;
                    if (w < 0x80) { utf8[0] = (char)w; utf8[1] = 0; }
                    else if (w < 0x800) { utf8[0] = (char)(0xC0 | (w >> 6)); utf8[1] = (char)(0x80 | (w & 0x3F)); utf8[2] = 0; }
                    else if (w < 0x10000) { utf8[0] = (char)(0xE0 | (w >> 12)); utf8[1] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[2] = (char)(0x80 | (w & 0x3F)); utf8[3] = 0; }
                    else { utf8[0] = (char)(0xF0 | (w >> 18)); utf8[1] = (char)(0x80 | ((w >> 12) & 0x3F)); utf8[2] = (char)(0x80 | ((w >> 6) & 0x3F)); utf8[3] = (char)(0x80 | (w & 0x3F)); utf8[4] = 0; }
                    ImGui::PushFont(icon_font);
                    bool clicked = ImGui::Button(utf8, ImVec2(28, 28));
                    ImGui::PopFont();
                    ImGui::SameLine();
                    ImGui::Text("U+%04X", cp);
                    if (clicked) {
                        char buf[16];
                        snprintf(buf, sizeof(buf), "U+%04X", cp);
                        ImGui::SetClipboardText(buf);
                    }
                    if (++col >= items_in_row) { col = 0; ImGui::NewLine(); }
                }
            } else {
                ImGui::TextUnformatted("No icon font loaded.");
            }
            ImGui::End();
        }
        
        ImGui::End();
        
        // Command palette window
        command_registry.render_command_palette();
    }
    
    void build_commands() {
        using gui::Command;
        // View: Spectrum
        command_registry.register_command(Command{
            "view.spectrum",
            "Show Spectrum View",
            "Ctrl+1",
            "View",
            [this]{ return true; },
            [this]{ show_settings_page = false; show_spectrum = true; show_waterfall = false; show_concentric = false; }
        });
        // View: Waterfall
        command_registry.register_command(Command{
            "view.waterfall",
            "Show Waterfall View",
            "Ctrl+2",
            "View",
            [this]{ return true; },
            [this]{ show_settings_page = false; show_waterfall = true; }
        });
        // View: Concentric
        command_registry.register_command(Command{
            "view.concentric",
            "Show Concentric View",
            "Ctrl+3",
            "View",
            [this]{ return true; },
            [this]{ show_settings_page = false; show_concentric = true; }
        });
        // View: Toggle variants (multi-view)
        command_registry.register_command(Command{
            "view.toggle_spectrum",
            "Toggle Spectrum View",
            "Ctrl+Shift+1",
            "View",
            [this]{ return true; },
            [this]{ show_spectrum = !show_spectrum; }
        });
        command_registry.register_command(Command{
            "view.toggle_waterfall",
            "Toggle Waterfall View",
            "Ctrl+Shift+2",
            "View",
            [this]{ return true; },
            [this]{ show_waterfall = !show_waterfall; }
        });
        command_registry.register_command(Command{
            "view.toggle_concentric",
            "Toggle Concentric View",
            "Ctrl+Shift+3",
            "View",
            [this]{ return true; },
            [this]{ show_concentric = !show_concentric; }
        });
        // View: Settings
        command_registry.register_command(Command{
            "view.settings",
            "Open Settings",
            "",
            "View",
            [this]{ return true; },
            [this]{ show_settings_page = true; }
        });
        // Audio: Toggle Microphone (placeholder)
        command_registry.register_command(Command{
            "audio.toggle_mic",
            "Toggle Microphone",
            "",
            "Audio",
            [this]{ return true; },
            [this]{ mic_enabled = !mic_enabled; }
        });
        // Help: Command Palette
        command_registry.register_command(Command{
            "help.palette",
            "Command Palette...",
            "Ctrl+P",
            "Help",
            [this]{ return true; },
            [this]{ command_registry.open_palette(); }
        });
    }
};

int main() {
    TunerGUI tuner;
    tuner.run();
    return 0;
}