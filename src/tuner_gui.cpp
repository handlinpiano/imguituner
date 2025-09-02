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

// ImGui + OpenGL ES 3 (Pi 4)
#include <GLES3/gl3.h>
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>

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
        
        ImGui_ImplGlfw_InitForOpenGL(window, true);
        // Use GLSL ES 3.0 shader version for OpenGL ES
        ImGui_ImplOpenGL3_Init("#version 300 es");
        
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
    static constexpr int waterfall_height = 200;
    
    float peak_frequency = 440.0f;
    float peak_magnitude = 0.0f;
    int frames_processed = 0;
    float last_rms = 0.0f;
    
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
        }
    }
    
    void render_gui() {
        ImGui::Begin("Piano Tuner");
        
        // Controls
        if (ImGui::SliderFloat("Center Freq", &center_frequency, 200.0f, 1000.0f, "%.1f Hz")) {
            // Center frequency changed
        }

        // Runtime tuning controls (precise only)
        // Fixed 16k FFT (disabled selector)
        ImGui::Text("FFT Size: 16384 (fixed)");
        precise_fft_size = 16384;
        ImGui::SliderInt("Precise D", &precise_decimation, 4, 64);
        ImGui::SliderFloat("Precise Window (s)", &precise_window_seconds, 0.20f, 0.60f, "%.2f s");

        ImGui::SliderInt("Frontend decim", &frontend_decimation, 1, 4);
        
        ImGui::Text("Peak: %.1f Hz (%.1f cents) | Mag: %.6f", 
                   peak_frequency, 
                   1200.0f * std::log2(peak_frequency / center_frequency),
                   peak_magnitude);
        ImGui::Text("Frames processed: %d", frames_processed);
        
        // Diagnostics for testing
        const int ui_required = last_required_samples;
        float fill_pct = ui_required > 0 ? (100.0f * static_cast<float>(std::min(last_window_samples, ui_required)) / static_cast<float>(ui_required)) : 0.0f;
        ImGui::Text("Fs: %u Hz | Fs_eff: %u Hz | D: %d | FFT: %d | Nz: %d (%.1f%% fill) | RMS: %.6f",
                   last_actual_fs, last_effective_fs, last_use_decimation, last_use_fft_size, last_nz, fill_pct, last_rms);
        
        // Spectrum plot
        if (!current_spectrum.empty()) {
            ImGui::Text("Spectrum (±120 cents)");
            ImGui::PlotLines("##spectrum", current_spectrum.data(), 
                           static_cast<int>(current_spectrum.size()), 
                           0, nullptr, 0.0f, FLT_MAX, ImVec2(0, 200));
        }
        
        // Waterfall display
        if (!waterfall_history.empty() && !waterfall_history[0].empty()) {
            ImGui::Text("Waterfall Display");
            
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 canvas_pos = ImGui::GetCursorScreenPos();
            ImVec2 canvas_size = ImVec2(800, 300);
            
            // Draw waterfall
            const float bin_width = canvas_size.x / zoom_config.numBins;
            const float row_height = canvas_size.y / waterfall_height;
            
            for (int row = 0; row < waterfall_height && row < static_cast<int>(waterfall_history.size()); ++row) {
                const auto& spectrum_row = waterfall_history[row];
                
                for (int bin = 0; bin < zoom_config.numBins && bin < static_cast<int>(spectrum_row.size()); ++bin) {
                    float intensity = std::min(1.0f, spectrum_row[bin] * 1000000.0f); // Scale for visibility
                    
                    ImU32 color = ImGui::ColorConvertFloat4ToU32(
                        ImVec4(intensity, intensity * 0.5f, 0.0f, 1.0f));
                    
                    ImVec2 p_min(canvas_pos.x + bin * bin_width, 
                                canvas_pos.y + row * row_height);
                    ImVec2 p_max(p_min.x + bin_width, p_min.y + row_height);
                    
                    draw_list->AddRectFilled(p_min, p_max, color);
                }
            }
            
            // Add frequency labels
            for (int cents = -120; cents <= 120; cents += 40) {
                float x = canvas_pos.x + (cents + 120) * canvas_size.x / 240.0f;
                draw_list->AddLine(ImVec2(x, canvas_pos.y), 
                                 ImVec2(x, canvas_pos.y + canvas_size.y), 
                                 IM_COL32(100, 100, 100, 255));
                
                char label[32];
                snprintf(label, sizeof(label), "%+d¢", cents);
                draw_list->AddText(ImVec2(x, canvas_pos.y - 20), 
                                 IM_COL32(255, 255, 255, 255), label);
            }
            
            ImGui::Dummy(canvas_size);
        }
        
        ImGui::End();
    }
};

int main() {
    TunerGUI tuner;
    tuner.run();
    return 0;
}