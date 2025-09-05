#pragma once
#include <array>
struct FrequencyRegion {
  double centerFrequency = 0.0;
  int startBin = 0;
  int endBin = 0;
  double envelopeMagnitude = 0.2;     // matches existing code usage
  double regionHighestMagnitude = 0.0;
  double envelopeMin = 1e9;
  bool active = false;
  bool isDisplayRegion = true;
  double rawMagnitude = 0.0;
  double peakFrequency = 0.0;
  double peakMagnitude = 0.0;
  int peakBin = 0;
  double peakConfidence = 0.0;
  // Per-frame noise and SNR estimates (raw domain)
  double noiseFloorRaw = 0.0;   // average of non-peak bins for current frame
  double snrLinear = 0.0;       // regionHighestMagnitude / noiseFloorRaw
  // Target search half-window in cents (used to size analysis bandwidth per region)
  double centsWindow = 120.0;
};

namespace AudioConfig { constexpr int MAX_REGIONS = 8; }



