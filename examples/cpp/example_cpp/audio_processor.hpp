// audio_processor.hpp
#pragma once

#include <string>
#include <memory>
#include <emscripten/val.h>
#include "types.hpp"

class AudioProcessorImpl; // forward declaration for PIMPL

class AudioProcessor {
public:
    AudioProcessor();
    ~AudioProcessor();

    // Core processing
    void processAudioDirectJS(emscripten::val inputPtr, emscripten::val outputPtr, int size, int currentSampleRate);
    void setFreqOverlapFactor(int factor);
    void setRegionFrequency(int regionIndex, double frequency, bool isDisplayRegion = true);

    // Region envelope controls
    double getRegionEnvelopeMax(int regionIndex);
    double getRegionEnvelopeMin(int regionIndex);
    void resetRegionEnvelopeMax(int regionIndex);
    void resetRegionEnvelopeMin(int regionIndex);
    void setRegionEnvelopeMax(int regionIndex, double value);
    void setRegionEnvelopeMin(int regionIndex, double value);
    void halveRegionDisplayEnvelope(int regionIndex);
    void setRegionCentsWindow(int regionIndex, double cents);

    // Region data helpers
    std::vector<float> getRegionData(int regionIndex);
    int getRegionBinCount(int regionIndex);
    double getRegionFrequencyPerBin(int regionIndex);
    double getRegionStartFrequency(int regionIndex);
    double getRegionEndFrequency(int regionIndex);
    double getRegionHighestMagnitude(int regionIndex) const;

    // Peak accessors
    double getRegionPeakFrequency(int regionIndex) const;
    double getRegionPeakMagnitude(int regionIndex) const;
    double getRegionPeakConfidence(int regionIndex) const;
    int getRegionPeakBin(int regionIndex) const;

    // Batched metadata / views
    RegionMetadata getRegionMetadata(int regionIndex) const;
    RegionDataView getRegionDataView(int regionIndex) const;

    // Strike detection
    std::string getStrikeState() const;
    bool isInMeasurementWindow() const;
    StrikeMeasurement getStrikeMeasurement() const;
    void clearStrikeMeasurement();
    void resetStrikeDetection();

    // Strike direct getters
    double getStrikeMeasurementFrequency() const;
    double getStrikeMeasurementMagnitude() const;
    double getStrikeMeasurementConfidence() const;
    double getStrikeMeasurementTimestamp() const;
    int getStrikeMeasurementSampleCount() const;
    bool getStrikeMeasurementIsValid() const;
    double getCurrentMagnitudeThreshold() const;

    // Strike configuration
    void setStrikeDetectionTrigger(float minMagnitude);
    void setRequiredDecayingClusters(int clusters);
    void setHarmonicCapturePartialNumber(int partialNumber);
    float getStrikeDetectionTrigger() const;
    int getRequiredDecayingClusters() const;

    // Callbacks / control
    void setHarmonicCaptureCallback(emscripten::val callback);
    void setStrikeStartCallback(emscripten::val cb);
    void setHarmonicCaptureEnabled(bool enabled);
    void setInharmonicityB(double b);

    // Zoom configuration (new engine)
    void setZoomDecimation(int decimation);
    void setZoomFftSize(int fftSize);
    void setZoomNumBins(int numBins);
    // windowType: 0 = Hann, 1 = Rectangular (temporary TS-exposed option while developing)
    void setZoomWindowType(int windowType);

    // Realtime line/capture lifecycle (new)
    void setLineUpdateCallback(emscripten::val cb);
    void beginHarmonicCapture(int partialNumber);
    void abortHarmonicCapture();
    
private:
    std::unique_ptr<AudioProcessorImpl> impl;
};


