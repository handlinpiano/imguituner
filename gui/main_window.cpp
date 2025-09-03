#include "audio_processor.hpp"
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
#include "spectrum_view.hpp"
#include "settings_page.hpp"
#include "app_settings.hpp"
#include "app_settings_io.hpp"

// ImGui + OpenGL ES 3 (Pi 4)
#include <GLES3/gl3.h>
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <fstream>

using namespace tuner;

// Copy exact working zoom FFT from your code
namespace zoom {

struct ZoomConfig {
  int decimation = 16;
  int fftSize = 16384;
  int numBins = 1200;
  int windowType = 0;  // 0=Hann
  int sampleRate = 48000;
};

struct Biquad {
  float b0, b1, b2, a1, a2;
  std::complex<float> z1{0.0f, 0.0f};
  std::complex<float> z2{0.0f, 0.0f};
  
  void setCoefficients(float b0_, float b1_, float b2_, float a0_, float a1_, float a2_) {
    float inv_a0 = 1.0f / a0_;
    b0 = b0_ * inv_a0; b1 = b1_ * inv_a0; b2 = b2_ * inv_a0;
    a1 = a1_ * inv_a0; a2 = a2_ * inv_a0;
  }
  
  std::complex<float> process(const std::complex<float>& x) {
    std::complex<float> w = x - a1 * z1 - a2 * z2;
    std::complex<float> y = b0 * w + b1 * z1 + b2 * z2;
    z2 = z1; z1 = w;
    return y;
  }
  
  void reset() { z1 = z2 = std::complex<float>(0.0f, 0.0f); }
};

struct ComplexSOSDecimator {
  static constexpr int NUM_SECTIONS = 4;
  std::array<Biquad, NUM_SECTIONS> sections;
  int decim = 1, decimCount = 0, sampleRate = 48000;
  
  void design(int fs, float, int decimation) {
    decim = std::max(1, decimation);
    decimCount = 0; sampleRate = fs;
    for (auto& s : sections) s.reset();
    
    // Joe filter coefficients
    sections[0].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9648f, 0.9891f);
    sections[1].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9517f, 0.9692f);
    sections[2].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9460f, 0.9542f);
    sections[3].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9444f, 0.9461f);
  }
  
  bool push(const std::complex<float>& x, std::complex<float>& yOut) {
    std::complex<float> y = x;
    for (auto& s : sections) y = s.process(y);
    if (++decimCount % decim != 0) return false;
    yOut = y; return true;
  }
};

// Precomputed twiddles for radix-2 and radix-4 butterflies (cache per size)
struct TwiddleCache {
  std::unordered_map<int, std::vector<std::vector<std::complex<float>>>> w2_cache; // len/2 twiddles per stage
  std::unordered_map<int, std::vector<std::vector<std::complex<float>>>> w4_cache; // len*3/4 twiddles per stage if needed

  const std::vector<std::vector<std::complex<float>>>& get_or_build_radix2(int n) {
    auto it = w2_cache.find(n);
    if (it != w2_cache.end()) return it->second;
    const float twoPi = 6.28318530717958647692f;
    std::vector<std::vector<std::complex<float>>> stages;
    for (int len = 2; len <= n; len <<= 1) {
      const float angle = -twoPi / static_cast<float>(len);
      const std::complex<float> wlen(std::cos(angle), std::sin(angle));
      const int half = len / 2;
      std::vector<std::complex<float>> stage(half);
      std::complex<float> w(1.0f, 0.0f);
      for (int k = 0; k < half; ++k) { stage[k] = w; w *= wlen; }
      stages.push_back(std::move(stage));
    }
    auto [ins, _] = w2_cache.emplace(n, std::move(stages));
    return ins->second;
  }
};

static std::unordered_map<int, std::vector<int>> g_bitrev;

static const std::vector<int>& get_or_build_bitrev(int n) {
  auto it = g_bitrev.find(n);
  if (it != g_bitrev.end()) return it->second;
  int bits = 0; while ((1 << bits) < n) ++bits;
  std::vector<int> br(n);
  for (int i = 0; i < n; ++i) {
    unsigned int v = static_cast<unsigned int>(i);
    unsigned int r = 0;
    for (int b = 0; b < bits; ++b) {
      r = (r << 1) | (v & 1u);
      v >>= 1;
    }
    br[i] = static_cast<int>(r);
  }
  auto [ins, _] = g_bitrev.emplace(n, std::move(br));
  return ins->second;
}

void small_fft(std::vector<std::complex<float>>& X) {
  static TwiddleCache twiddles;
  const int n = static_cast<int>(X.size());
  if (n <= 1) return;

  // Bit reversal via precomputed table (scatter copy once)
  const auto& br = get_or_build_bitrev(n);
  std::vector<std::complex<float>> a(n);
  for (int i = 0; i < n; ++i) a[br[i]] = X[i];
  X.swap(a);

  // FFT using precomputed radix-2 twiddles (optimized for 16384)
  const auto& stages = twiddles.get_or_build_radix2(n);
  int stageIndex = 0;
  for (int len = 2; len <= n; len <<= 1, ++stageIndex) {
    const auto& W = stages[stageIndex]; // size len/2
    for (int i = 0; i < n; i += len) {
      for (int k = 0; k < len / 2; ++k) {
        const auto u = X[i + k];
        const auto v = X[i + k + len / 2] * W[k];
        X[i + k] = u + v;
        X[i + k + len / 2] = u - v;
      }
    }
  }
}

std::vector<float> computeZoomMagnitudes(const float* input, int inputLength, double centerHz, const ZoomConfig& cfg) {
  const int D = std::max(1, cfg.decimation);
  const int N = inputLength;
  const int Nz = std::min(cfg.fftSize, N / D);
  if (Nz <= 8 || !input || cfg.sampleRate <= 0 || centerHz <= 0.0) {
    return std::vector<float>(std::max(1, cfg.numBins), 0.0f);
  }

  const float twoPi = 6.28318530717958647692f;
  const float omega = twoPi * static_cast<float>(centerHz) / static_cast<float>(cfg.sampleRate);
  const std::complex<float> w(std::cos(-omega), std::sin(-omega));
  std::complex<float> p(1.0f, 0.0f);

  std::vector<std::complex<float>> z(Nz);
  ComplexSOSDecimator filter;
  filter.design(cfg.sampleRate, 0.0f, D);

  int outIdx = 0, renormCounter = 0;
  for (int n = 0; n < N && outIdx < Nz; ++n) {
    const std::complex<float> mixed = p * input[n];
    p *= w;
    if ((++renormCounter & 8191) == 0) {
      float mag = std::abs(p);
      if (mag > 0.0f) p /= mag;
    }
    std::complex<float> y;
    if (filter.push(mixed, y)) z[outIdx++] = y;
  }
  for (; outIdx < Nz; ++outIdx) z[outIdx] = std::complex<float>(0.0f, 0.0f);

  if (cfg.windowType == 0) { // Hann
    for (int k = 0; k < Nz; ++k) {
      const float wv = 0.5f * (1.0f - std::cos(twoPi * static_cast<float>(k) / static_cast<float>(Nz - 1)));
      z[k] *= wv;
    }
  }

  std::vector<std::complex<float>> X(cfg.fftSize, std::complex<float>(0.0f, 0.0f));
  for (int k = 0; k < Nz; ++k) X[k] = z[k];
  small_fft(X);

  std::vector<float> mags(cfg.fftSize);
  for (int k = 0; k < cfg.fftSize; ++k) mags[k] = std::hypot(X[k].real(), X[k].imag());

  std::vector<float> out(std::max(1, cfg.numBins), 0.0f);
  const float fsz = static_cast<float>(cfg.sampleRate) / static_cast<float>(D);
  const float centsSpan = 240.0f, centsMin = -120.0f;
  
  for (int b = 0; b < cfg.numBins; ++b) {
    const float cents = centsMin + centsSpan * (static_cast<float>(b) / static_cast<float>(cfg.numBins - 1));
    const float targetHzAbs = static_cast<float>(centerHz) * std::pow(2.0f, cents / 1200.0f);
    const float basebandHz = targetHzAbs - static_cast<float>(centerHz);
    if (std::fabs(basebandHz) > (fsz * 0.5f)) { out[b] = 0.0f; continue; }
    const float binf = (basebandHz / fsz) * static_cast<float>(cfg.fftSize);
    const int k0 = static_cast<int>(std::floor(binf));
    const float frac = binf - static_cast<float>(k0);
    const int i0 = ((k0 % cfg.fftSize) + cfg.fftSize) % cfg.fftSize;
    const int i1 = (i0 + 1) % cfg.fftSize;
    out[b] = mags[i0] * (1.0f - frac) + mags[i1] * frac;
  }
  return out;
}

} // namespace zoom

class TunerGUI {
public:
    TunerGUI() : center_frequency(440.0f) {
        // Initialize waterfall history
        waterfall_history.resize(waterfall_height);
        for (auto& row : waterfall_history) {
            row.resize(zoom_config.numBins, 0.0f);
        }
        
        // Setup audio
        audio_config.device_name = "hw:1,0";
        audio_config.sample_rate = 48000;
        audio_config.period_size = 64; // lower latency callbacks
        
        // Default zoom parameters (will adapt at runtime between fast/precise)
        zoom_config.decimation = 16;
        zoom_config.fftSize = 16384;
        zoom_config.numBins = 1200;

        audio_processor = std::make_unique<AudioProcessor>(audio_config);
        audio_processor->set_process_callback([this](const float* input, int num_samples) {
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
        frontend_decimation = settings.frontend_decimation;
        spectrum_view.show_frequency_lines = settings.show_frequency_lines;
        spectrum_view.show_peak_line = settings.show_peak_line;
        spectrum_view.bell_curve_width = settings.bell_curve_width;
        spectrum_view.color_scheme_idx = settings.color_scheme_idx;
        
        return true;
    }
    
    void run() {
        if (!init_gui()) return;
        
        if (!audio_processor->start()) {
            std::cerr << "Failed to start audio\n";
            return;
        }
        
        while (!glfwWindowShouldClose(window)) {
            glfwPollEvents();
            
            // Start ImGui frame
            ImGui_ImplOpenGL3_NewFrame();
            ImGui_ImplGlfw_NewFrame();
            ImGui::NewFrame();
            
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
        settings.frontend_decimation = frontend_decimation;
        settings.show_frequency_lines = spectrum_view.show_frequency_lines;
        settings.show_peak_line = spectrum_view.show_peak_line;
        settings.bell_curve_width = spectrum_view.bell_curve_width;
        settings.color_scheme_idx = spectrum_view.color_scheme_idx;
        save_settings(settings_path, settings);

        // Cleanup
        audio_processor->stop();
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();
        glfwDestroyWindow(window);
        glfwTerminate();
    }
    
private:
    GLFWwindow* window = nullptr;
    float center_frequency;
    zoom::ZoomConfig zoom_config;
    AudioConfig audio_config;
    std::unique_ptr<AudioProcessor> audio_processor;
    int frontend_decimation = 2; // Use every 2nd sample (effective 24k from 48k)
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
    std::deque<std::vector<float>> waterfall_history;
    static constexpr int waterfall_height = 400;
    int waterfall_filled_rows = 0;
    
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
    bool show_waterfall = false;
    
    bool show_settings_page = false;


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
        const unsigned int actual_fs = audio_processor->get_config().sample_rate;
        const unsigned int effective_fs = actual_fs / static_cast<unsigned int>(std::max(1, frontend_decimation));
        zoom_config.sampleRate = static_cast<int>(effective_fs);
        last_actual_fs = actual_fs;
        last_effective_fs = effective_fs;

        // Append front-end decimated samples to ring buffer
        if (input && num_samples > 0) {
            for (int i = 0; i < num_samples; i += std::max(1, frontend_decimation)) {
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

        // Precise-only processing path
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

        // Configure zoom for selected path
        zoom::ZoomConfig cfg = zoom_config;
        cfg.fftSize = use_fft_size;
        cfg.decimation = use_decimation;
        cfg.sampleRate = static_cast<int>(last_effective_fs);

        // Expected decimated output length Nz
        last_nz = std::min(cfg.fftSize, static_cast<int>(proc_input.size()) / std::max(1, cfg.decimation));
        
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
            magnitudes = zoom::computeZoomMagnitudes(chunk_decimated.data(), static_cast<int>(chunk_decimated.size()), center_frequency, cfg);
        } else {
            magnitudes = zoom::computeZoomMagnitudes(proc_input.data(), static_cast<int>(proc_input.size()), center_frequency, cfg);
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
        float cents = -120.0f + 240.0f * (static_cast<float>(peak_bin) / (zoom_config.numBins - 1));
        peak_frequency = center_frequency * std::pow(2.0f, cents / 1200.0f);
        peak_magnitude = max_mag;
        frames_processed++;
        
        // Update waterfall (every few frames to avoid too much data)
        if (frames_processed % 4 == 0) {
            waterfall_history.pop_front();
            waterfall_history.push_back(magnitudes);
            if (waterfall_filled_rows < waterfall_height) ++waterfall_filled_rows;
        }
    }
    
    void render_gui() {
        ImGui::Begin("Piano Tuner");
        
        // Layout: top and bottom adapt to content height; center uses the rest
        ImVec2 avail = ImGui::GetContentRegionAvail();
        const float frame_h = ImGui::GetFrameHeightWithSpacing();
        float h_top = frame_h * 2.0f;
        float h_bot = frame_h * 1.5f;
        float h_mid = std::max(0.0f, avail.y - h_top - h_bot);

        // Top bar
        ImGui::BeginChild("TopBar", ImVec2(0, h_top), true);
        ImGui::Columns(4, nullptr, false);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        if (ImGui::Button(u8"\uE587")) show_settings_page = false; // Material Icons: home
        ImGui::NextColumn();
        ImGui::Text("Piano Tuner");
        ImGui::NextColumn();
        if (ImGui::Button(u8"\uE3AC")) show_settings_page = true; // Material Icons: settings
        ImGui::NextColumn();
        {
            const char* mic_icon = u8"\uE31D"; // Material Icons: microphone
            const bool mic_was_off = !mic_enabled;
            if (mic_was_off) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(90, 40, 40, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(120, 60, 60, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(140, 70, 70, 255));
            }
            if (ImGui::Button(mic_icon)) {
                mic_enabled = !mic_enabled;
            }
            if (mic_was_off) ImGui::PopStyleColor(3);
            ImGui::SameLine();
            // Waterfall toggle (Material Icons: U+E176)
            const char* waterfall_icon = u8"\uE176";
            const bool waterfall_was_on = show_waterfall;
            if (waterfall_was_on) {
                ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(40, 90, 150, 200));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, IM_COL32(60, 120, 180, 220));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, IM_COL32(70, 140, 200, 255));
            }
            if (ImGui::Button(waterfall_icon)) {
                show_waterfall = !show_waterfall;
            }
            if (waterfall_was_on) ImGui::PopStyleColor(3);
            ImGui::SameLine();
            if (ImGui::Button("Icons")) show_icon_browser = !show_icon_browser;
        }
        ImGui::Columns(1);
        ImGui::PopStyleVar();
        ImGui::EndChild();

        // Middle content
        ImGui::BeginChild("CenterContent", ImVec2(0, h_mid), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
        if (show_settings_page) {
            settings_page.render(center_frequency,
                                 precise_fft_size,
                                 precise_decimation,
                                 precise_window_seconds,
                                 frontend_decimation,
                                 spectrum_view);
        } else {
            if (show_waterfall) {
                // Simple waterfall using accumulated history
                ImDrawList* draw_list = ImGui::GetWindowDrawList();
                ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                ImVec2 m_av = ImGui::GetContentRegionAvail();
                const float width = m_av.x;
                const float height = m_av.y;
                ImVec2 canvas_size(width, height);
                const ImVec2 p0 = canvas_pos;
                const ImVec2 p1 = ImVec2(canvas_pos.x + width, canvas_pos.y + height);
                draw_list->AddRectFilled(p0, p1, IM_COL32(15,15,18,255));
                draw_list->AddRect(p0, p1, IM_COL32(60,60,60,255));
                ImGui::PushClipRect(p0, p1, true);
                const int rows = std::max(1, std::min(waterfall_filled_rows, (int)waterfall_history.size()));
                if (rows > 0 && !waterfall_history[0].empty()) {
                    const int cols = (int)waterfall_history[0].size();
                    const float bin_width = width / std::max(1, cols);
                    const float row_height = height / std::max(1, rows);
                    // Use SpectrumView color scheme for consistent palette
                    const auto& schemes = spectrum_view.schemes();
                    const auto& scheme = schemes[std::max(0, std::min((int)schemes.size()-1, spectrum_view.color_scheme_idx))];
                    for (int r = 0; r < rows; ++r) {
                        // Take the last 'rows' entries so we stretch them over the full height
                        const int base_index = (int)waterfall_history.size() - rows;
                        const auto& spectrum_row = waterfall_history[base_index + r];
                        // Per-row max for normalization
                        float row_max = 0.0f;
                        for (int c = 0; c < cols && c < (int)spectrum_row.size(); ++c) row_max = std::max(row_max, spectrum_row[c]);
                        if (row_max <= 0.0f) row_max = 1.0f;
                        for (int c = 0; c < cols && c < (int)spectrum_row.size(); ++c) {
                            float t = spectrum_row[c] / row_max; // 0..1
                            // Interpolate selected color scheme
                            float rcp = t, gcp = t, bcp = t;
                            for (size_t si = 0; si + 1 < scheme.stops.size(); ++si) {
                                const auto& s0 = scheme.stops[si];
                                const auto& s1 = scheme.stops[si+1];
                                if (t <= s1.position) {
                                    float span = (s1.position - s0.position);
                                    float u = span > 0.0f ? (t - s0.position) / span : 0.0f;
                                    rcp = s0.r + (s1.r - s0.r) * u;
                                    gcp = s0.g + (s1.g - s0.g) * u;
                                    bcp = s0.b + (s1.b - s0.b) * u;
                                    break;
                                }
                            }
                            ImU32 col = IM_COL32((int)(rcp*255.0f), (int)(gcp*255.0f), (int)(bcp*255.0f), 255);
                            const float x0 = canvas_pos.x + c * bin_width;
                            const float y0 = canvas_pos.y + r * row_height;
                            // Clamp last column/row to exact canvas edge to avoid visible gaps/clipping
                            const float x1 = (c == cols - 1) ? p1.x : (x0 + bin_width);
                            const float y1 = (r == rows - 1) ? p1.y : (y0 + row_height);
                            ImVec2 p_min(x0, y0);
                            ImVec2 p_max(x1, y1);
                            draw_list->AddRectFilled(p_min, p_max, col);
                        }
                    }
                }
                ImGui::PopClipRect();
                // Reserve no extra space; child has fixed height, and scrollbars are disabled
            } else if (!current_spectrum.empty()) {
                ImDrawList* dl = ImGui::GetWindowDrawList();
                ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
                ImVec2 m_av = ImGui::GetContentRegionAvail();
                const float width = std::max(200.0f, m_av.x);
                const float height = std::max(120.0f, m_av.y);
                ImVec2 canvas_size(width, height);
                spectrum_view.draw(dl, canvas_pos, width, height, current_spectrum, center_frequency, peak_frequency, peak_magnitude);
                // Reserve no extra space; child has fixed height, and scrollbars are disabled
            }
        }
        ImGui::EndChild();

        // Bottom bar with 4 columns and placeholder icons
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
    }
};

int main() {
    TunerGUI tuner;
    tuner.run();
    return 0;
}