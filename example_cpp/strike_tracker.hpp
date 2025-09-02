#pragma once

#include <cmath>

struct StrikeTrackerConfig {
  float thresholdScale = 0.3f; // threshold = scale * envelopeMax
  int requiredDecayingClusters = 3; // consecutive down frames needed
  float resetThresholdScale = 0.29f; // 29% of declining cluster magnitude
  float retriggerLowThreshold = 0.6f; // 60% threshold for retrigger detection
  float retriggerHighThreshold = 0.75f; // 75% threshold for retrigger confirmation
};

enum class StrikeState { WAITING, ATTACK, MONITORING };

class StrikeTracker {
public:
  StrikeTracker();

  void setSampleRate(int sr);
  void setConfig(const StrikeTrackerConfig& cfg);
  void reset();

  // Simplified update: just magnitude and frequency needed
  void update(double rawPeak, double envelopeMax, double peakHz, int frameSize);

  StrikeState state() const { return currentState; }
  double getEmaMagnitude() const { return emaMagnitude; }
  double getMeasuredFrequency() const { return measuredFrequency; }
  StrikeState getPreviousState() const { return prevState; }
  double getLastStrikeStartSec() const { return strikeStartTimeSec; }
  bool hasRetrigger() const { return retriggerDetected; }
  void clearRetrigger() { retriggerDetected = false; }

private:
  // Timekeeping
  int sampleRate = 0;
  double processedSamples = 0.0;

  // EMA magnitude tracking
  double emaMagnitude = 0.0;
  double prevEmaMagnitude = 0.0;
  
  // Strike detection state
  int decayingStreak = 0;
  double decliningClusterMagnitude = 0.0; // Magnitude when we reached required declining clusters
  double measuredFrequency = 0.0; // Frequency captured when declining clusters reached
  bool retriggerDetected = false;
  bool retriggerArmed = false;
  
  // Config
  StrikeTrackerConfig config{};

  // State machine
  StrikeState currentState = StrikeState::WAITING;
  StrikeState prevState = StrikeState::WAITING;
  double strikeStartTimeSec = 0.0;
};



