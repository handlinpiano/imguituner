#include "audio_input.hpp"
#include <iostream>
#include <iomanip>
#include <vector>
#include <complex>
#include <cmath>
#include <algorithm>
#include <array>
#include <atomic>
#include <signal.h>
#include <thread>
#include <chrono>

using namespace tuner;

// Copy the exact working code from zoom_engine.cpp
namespace zoom {

struct ZoomConfig {
  int decimation;      // e.g., 16 or 32
  int fftSize;         // e.g., 16384
  int numBins;         // e.g., 1200
  int windowType;      // 0=Hann, 1=Rectangular
  int sampleRate;      // input sample rate
};

// Biquad filter section for complex signals
struct Biquad {
  float b0, b1, b2, a1, a2;
  std::complex<float> z1{0.0f, 0.0f};
  std::complex<float> z2{0.0f, 0.0f};
  
  void setCoefficients(float b0_, float b1_, float b2_, float a0_, float a1_, float a2_) {
    float inv_a0 = 1.0f / a0_;
    b0 = b0_ * inv_a0;
    b1 = b1_ * inv_a0;
    b2 = b2_ * inv_a0;
    a1 = a1_ * inv_a0;
    a2 = a2_ * inv_a0;
  }
  
  std::complex<float> process(const std::complex<float>& x) {
    std::complex<float> w = x - a1 * z1 - a2 * z2;
    std::complex<float> y = b0 * w + b1 * z1 + b2 * z2;
    z2 = z1;
    z1 = w;
    return y;
  }
  
  void reset() {
    z1 = std::complex<float>(0.0f, 0.0f);
    z2 = std::complex<float>(0.0f, 0.0f);
  }
};

// Joe filter implementation: 8th-order Butterworth as 4 cascaded biquads
struct ComplexSOSDecimator {
  static constexpr int NUM_SECTIONS = 4;  // 8th order filter
  std::array<Biquad, NUM_SECTIONS> sections;
  int decim = 1;
  int decimCount = 0;
  int sampleRate = 44100;
  
  void design(int fs, float /*cutoffHz*/, int decimation) {
    decim = std::max(1, decimation);
    decimCount = 0;
    sampleRate = fs;
    
    // Reset all sections
    for (auto& section : sections) {
      section.reset();
    }
    
    // Joe filter: 8th-order Butterworth LPF as cascaded biquads
    sections[0].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9648f, 0.9891f);
    sections[1].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9517f, 0.9692f);
    sections[2].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9460f, 0.9542f);
    sections[3].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9444f, 0.9461f);
  }
  
  bool push(const std::complex<float>& x, std::complex<float>& yOut) {
    std::complex<float> y = x;
    for (auto& section : sections) {
      y = section.process(y);
    }
    
    decimCount++;
    if ((decimCount % decim) != 0) return false;
    
    yOut = y;
    return true;
  }
};

static inline void small_fft(std::vector<std::complex<float>>& X) {
  const int n = static_cast<int>(X.size());
  int j = 0;
  for (int i = 1; i < n; ++i) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(X[i], X[j]);
  }
  const float twoPi = 6.28318530717958647692f;
  for (int len = 2; len <= n; len <<= 1) {
    const float ang = -twoPi / len;
    const std::complex<float> wlen(std::cos(ang), std::sin(ang));
    for (int i = 0; i < n; i += len) {
      std::complex<float> w(1.0f, 0.0f);
      for (int k2 = 0; k2 < len / 2; ++k2) {
        auto u = X[i + k2];
        auto v = X[i + k2 + len / 2] * w;
        X[i + k2] = u + v;
        X[i + k2 + len / 2] = u - v;
        w *= wlen;
      }
    }
  }
}

// EXACT copy from your working zoom_engine.cpp
std::vector<float> computeZoomMagnitudes(
    const float* input, int inputLength, double centerHz, const ZoomConfig& cfg) {
  const int D = std::max(1, cfg.decimation);
  const int N = inputLength;
  const int Nz = std::min(cfg.fftSize, N / D);
  if (Nz <= 8 || input == nullptr || cfg.sampleRate <= 0 || centerHz <= 0.0) {
    return std::vector<float>(std::max(1, cfg.numBins), 0.0f);
  }

  const float twoPi = 6.28318530717958647692f;
  const float omega = twoPi * static_cast<float>(centerHz) / static_cast<float>(cfg.sampleRate);
  const std::complex<float> w(std::cos(-omega), std::sin(-omega));
  std::complex<float> p(1.0f, 0.0f);

  std::vector<std::complex<float>> z(Nz);
  
  ComplexSOSDecimator filter;
  filter.design(cfg.sampleRate, 0.0f, D);

  int outIdx = 0;
  int renormCounter = 0;
  for (int n = 0; n < N && outIdx < Nz; ++n) {
    const float xn = input[n];
    const std::complex<float> mixed = p * xn;
    p *= w;
    if ((++renormCounter & 8191) == 0) {
      float mag = std::abs(p);
      if (mag > 0.0f) p /= mag;
    }
    std::complex<float> y;
    if (filter.push(mixed, y)) {
      z[outIdx++] = y;
    }
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
  for (int k = 0; k < cfg.fftSize; ++k) {
    mags[k] = std::hypot(X[k].real(), X[k].imag());
  }

  std::vector<float> out(std::max(1, cfg.numBins), 0.0f);
  const float fsz = static_cast<float>(cfg.sampleRate) / static_cast<float>(D);
  const float centsSpan = 240.0f;
  const float centsMin = -120.0f;
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
    const float v0 = mags[i0];
    const float v1 = mags[i1];
    out[b] = v0 * (1.0f - frac) + v1 * frac;
  }

  return out;
}

} // namespace zoom

std::atomic<bool> g_running(true);
void signal_handler(int) { g_running = false; }

int main(int argc, char* argv[]) {
    signal(SIGINT, signal_handler);
    
    std::string device = "hw:1,0";
    if (argc > 1) device = argv[1];
    
    std::cout << "Direct Zoom Test - Device: " << device << std::endl;
    
    zoom::ZoomConfig config;
    config.decimation = 16;
    config.fftSize = 16384;
    config.numBins = 1200;
    config.windowType = 0;  // Hann
    config.sampleRate = 48000;
    
    AudioConfig audio_config;
    audio_config.device_name = device;
    audio_config.sample_rate = 48000;
    audio_config.period_size = 1024;  // Larger buffer
    
    std::atomic<float> peak_magnitude(0);
    std::atomic<int> peak_bin(0);
    
    auto audio = createAudioInput(audio_config);
    
    audio->set_process_callback([&](const float* input, int num_samples) {
        auto mags = zoom::computeZoomMagnitudes(input, num_samples, 440.0, config);
        
        float peak = 0;
        int peak_idx = 0;
        for (size_t i = 0; i < mags.size(); ++i) {
            if (mags[i] > peak) {
                peak = mags[i];
                peak_idx = i;
            }
        }
        
        peak_magnitude = peak;
        peak_bin = peak_idx;
    });
    
    if (!audio->start()) {
        std::cerr << "Audio failed\n";
        return 1;
    }
    
    std::cout << "Listening for 440 Hz...\n";
    
    while (g_running) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        float mag = peak_magnitude.load();
        int bin = peak_bin.load();
        
        // Convert bin to cents
        float cents = -120.0f + 240.0f * (static_cast<float>(bin) / 1199.0f);
        
        std::cout << "Peak: bin=" << bin << " cents=" << std::fixed << std::setprecision(1) 
                  << cents << " mag=" << std::setprecision(6) << mag << std::endl;
    }
    
    return 0;
}