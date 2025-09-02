#include "strike_tracker.hpp"

StrikeTracker::StrikeTracker() = default;

void StrikeTracker::setSampleRate(int sr) {
  sampleRate = sr;
}

void StrikeTracker::setConfig(const StrikeTrackerConfig& cfg) {
  config = cfg;
}

void StrikeTracker::reset() {
  processedSamples = 0.0;
  emaMagnitude = 0.0;
  prevEmaMagnitude = 0.0;
  decayingStreak = 0;
  decliningClusterMagnitude = 0.0;
  measuredFrequency = 0.0;
  retriggerDetected = false;
  retriggerArmed = false;
  currentState = StrikeState::WAITING;
  prevState = StrikeState::WAITING;
  strikeStartTimeSec = 0.0;
}

void StrikeTracker::update(double rawPeak, double envelopeMax, double peakHz, int frameSize) {
  if (sampleRate <= 0) return;

  processedSamples += frameSize;
  const double nowSec = processedSamples / static_cast<double>(sampleRate);

  // Use raw magnitude (no EMA)
  prevEmaMagnitude = emaMagnitude;
  emaMagnitude = rawPeak;

  // Threshold for initial trigger
  const double threshold = static_cast<double>(config.thresholdScale) * envelopeMax;

  // Track previous state before updating
  prevState = currentState;

  switch (currentState) {
    case StrikeState::WAITING: {
      // Cross threshold to start tracking
      if (rawPeak > threshold) {
        currentState = StrikeState::ATTACK;
        strikeStartTimeSec = nowSec;
        decayingStreak = 0;
        retriggerDetected = false;
        retriggerArmed = false;
      }
      break;
    }
    case StrikeState::ATTACK: {
      // Look for X declining clusters using raw magnitudes
      if (rawPeak < prevEmaMagnitude) {
        decayingStreak++;
        
        // When we reach required declining clusters, transition to MONITORING and capture frequency
        if (decayingStreak >= config.requiredDecayingClusters) {
          currentState = StrikeState::MONITORING;
          decliningClusterMagnitude = rawPeak;
          measuredFrequency = peakHz; // Take measurement immediately after declining clusters
          retriggerArmed = false;
        }
      } else {
        // Reset declining streak if magnitude increases (but stay in ATTACK state)
        decayingStreak = 0;
      }

      // Fall back to WAITING if we drop too low without finding declining clusters
      if (rawPeak < threshold * 0.8) {
        currentState = StrikeState::WAITING;
        decayingStreak = 0;
        retriggerArmed = false;
      }
      break;
    }
    case StrikeState::MONITORING: {
      const double resetThreshold = decliningClusterMagnitude * config.resetThresholdScale; // 29%
      const double retriggerLow = decliningClusterMagnitude * config.retriggerLowThreshold; // 60%
      const double retriggerHigh = decliningClusterMagnitude * config.retriggerHighThreshold; // 75%

      // Reset to WAITING if drops to 29% of declining cluster magnitude
      if (rawPeak < resetThreshold) {
        currentState = StrikeState::WAITING;
        decayingStreak = 0;
        retriggerArmed = false;
      }
      // Retrigger arm/confirm: from below 60% then above 75%
      else if (rawPeak < retriggerLow) {
        retriggerArmed = true;
      } else if (retriggerArmed && rawPeak > retriggerHigh) {
        // Detected retrigger: magnitude went from below 60% to above 75%
        retriggerDetected = true;
        measuredFrequency = peakHz; // Take new measurement on retrigger
        retriggerArmed = false;
      }
      break;
    }
  }
}

