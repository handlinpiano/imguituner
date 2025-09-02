#pragma once
#include <vector>
#include <complex>

namespace zoom {

struct ZoomConfig {
  int decimation;      // e.g., 16 or 32
  int fftSize;         // e.g., 16384
  int numBins;         // e.g., 1200
  int windowType;      // 0=Hann, 1=Rectangular
  int sampleRate;      // input sample rate
};

// Performs heterodyne+decimate+window+FFT and samples ±120¢ around centerHz.
// Returns sampled magnitudes (length = config.numBins). Magnitudes are linear.
std::vector<float> computeZoomMagnitudes(
    const float* input, int inputLength, double centerHz, const ZoomConfig& config);

}


