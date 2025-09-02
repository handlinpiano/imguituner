#include "zoom_engine.hpp"
#include <cmath>
#include <algorithm>
#include <array>

namespace zoom {

// Biquad filter section for complex signals
// Implements Direct Form II for numerical stability
struct Biquad {
  // Coefficients: b0, b1, b2, a0, a1, a2 (a0 is always 1.0)
  float b0, b1, b2, a1, a2;
  // State variables for Direct Form II
  std::complex<float> z1{0.0f, 0.0f};
  std::complex<float> z2{0.0f, 0.0f};
  
  void setCoefficients(float b0_, float b1_, float b2_, float a0_, float a1_, float a2_) {
    // Normalize by a0
    float inv_a0 = 1.0f / a0_;
    b0 = b0_ * inv_a0;
    b1 = b1_ * inv_a0;
    b2 = b2_ * inv_a0;
    a1 = a1_ * inv_a0;
    a2 = a2_ * inv_a0;
  }
  
  std::complex<float> process(const std::complex<float>& x) {
    // Direct Form II implementation
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
// Processes complex baseband signals with integrated decimation
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
    // Passband: 0.027 * Fs (e.g., 1.2kHz @ 44.1kHz, 2.6kHz @ 96kHz)
    // Format: b0, b1, b2, a0, a1, a2 per section
    sections[0].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9648f, 0.9891f);
    sections[1].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9517f, 0.9692f);
    sections[2].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9460f, 0.9542f);
    sections[3].setCoefficients(1.0f, 2.0f, 1.0f, 1.0f, -1.9444f, 0.9461f);
  }
  
  // Push one complex sample; return true if an output is ready (every decim samples)
  bool push(const std::complex<float>& x, std::complex<float>& yOut) {
    // Process through cascade
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
  
  // Joe filter: Butterworth LPF for anti-aliasing before decimation
  // Passband scales with sample rate: 0.027 * Fs
  // Provides ±120 cents bandwidth for piano harmonic analysis
  ComplexSOSDecimator filter;
  filter.design(cfg.sampleRate, 0.0f, D);  // cutoffHz param not used with fixed SOS

  int outIdx = 0;
  int renormCounter = 0;
  for (int n = 0; n < N && outIdx < Nz; ++n) {
    const float xn = input[n];
    const std::complex<float> mixed = p * xn; // preserve implicit real->complex promotion
    p *= w;
    if ((++renormCounter & 8191) == 0) { // periodic renormalization
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

}


