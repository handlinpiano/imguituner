#include <emscripten/bind.h>
#include "types.hpp"
#include "audio_processor.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(audio_processor_bindings_split) {
  register_vector<float>("VectorFloat");

  // StrikeMeasurement and harmonic stats
  value_array<std::array<HarmonicStatistics, 8>>("HarmonicStatisticsArray")
    .element(emscripten::index<0>())
    .element(emscripten::index<1>())
    .element(emscripten::index<2>())
    .element(emscripten::index<3>())
    .element(emscripten::index<4>())
    .element(emscripten::index<5>())
    .element(emscripten::index<6>())
    .element(emscripten::index<7>());

  value_object<HarmonicStatistics>("HarmonicStatistics")
    .field("ratio_mean", &HarmonicStatistics::frequency_mean)
    .field("ratio_std", &HarmonicStatistics::ratio_std)
    .field("magnitude_mean", &HarmonicStatistics::magnitude_mean)
    .field("magnitude_median", &HarmonicStatistics::magnitude_median_scaled)
    .field("magnitude_std", &HarmonicStatistics::magnitude_std)
    .field("confidence_mean", &HarmonicStatistics::confidence_mean)
    .field("sample_count", &HarmonicStatistics::sample_count)
    .field("outlier_rate", &HarmonicStatistics::outlier_rate)
    .field("is_valid", &HarmonicStatistics::is_valid);

  value_object<StrikeMeasurement>("StrikeMeasurement")
    .field("timestamp", &StrikeMeasurement::timestamp)
    .field("frequency", &StrikeMeasurement::frequency)
    .field("magnitude", &StrikeMeasurement::magnitude)
    .field("confidence", &StrikeMeasurement::confidence)
    .field("isValid", &StrikeMeasurement::isValid)
    .field("aboveThreshold", &StrikeMeasurement::aboveThreshold)
    .field("inWindow", &StrikeMeasurement::inWindow)
    .field("harmonicStatistics", &StrikeMeasurement::harmonicStatistics)
    .field("windowSampleCount", &StrikeMeasurement::windowSampleCount)
    .field("windowDuration", &StrikeMeasurement::windowDuration)
    .field("hasWindowData", &StrikeMeasurement::hasWindowData)
    .field("displayRegionHarmonicIndex", &StrikeMeasurement::displayRegionHarmonicIndex)
    .field("strikeId", &StrikeMeasurement::strikeId)
    .field("unisonDetected", &StrikeMeasurement::unisonDetected)
    .field("unisonReasonMask", &StrikeMeasurement::unisonReasonMask)
    .field("windowPeakJitterCents", &StrikeMeasurement::windowPeakJitterCents)
    .field("windowEnvelopeLFPower", &StrikeMeasurement::windowEnvelopeLFPower)
    .field("windowCoherence", &StrikeMeasurement::windowCoherence);

  // Region metadata and data view
  value_object<RegionMetadata>("RegionMetadata")
    .field("binCount", &RegionMetadata::binCount)
    .field("frequencyPerBin", &RegionMetadata::frequencyPerBin)
    .field("startFrequency", &RegionMetadata::startFrequency)
    .field("endFrequency", &RegionMetadata::endFrequency)
    .field("envelopeMax", &RegionMetadata::envelopeMax)
    .field("envelopeMin", &RegionMetadata::envelopeMin)
    .field("highestMagnitude", &RegionMetadata::highestMagnitude)
    .field("peakFrequency", &RegionMetadata::peakFrequency)
    .field("peakMagnitude", &RegionMetadata::peakMagnitude)
    .field("peakBin", &RegionMetadata::peakBin)
    .field("peakConfidence", &RegionMetadata::peakConfidence);

  value_object<RegionDataView>("RegionDataView")
    .field("dataPtr", &RegionDataView::dataPtr)
    .field("length", &RegionDataView::length)
    .field("startBin", &RegionDataView::startBin)
    .field("endBin", &RegionDataView::endBin);

  class_<AudioProcessor>("AudioProcessor")
    .constructor<>()
    .function("processAudioDirect", &AudioProcessor::processAudioDirectJS)
    // Zoom configuration (new engine)
    .function("setZoomDecimation", &AudioProcessor::setZoomDecimation)
    .function("setZoomFftSize", &AudioProcessor::setZoomFftSize)
    .function("setZoomNumBins", &AudioProcessor::setZoomNumBins)
    .function("setZoomWindowType", &AudioProcessor::setZoomWindowType)
    // Realtime/capture lifecycle
    .function("setLineUpdateCallback", &AudioProcessor::setLineUpdateCallback)
    .function("beginHarmonicCapture", &AudioProcessor::beginHarmonicCapture)
    .function("abortHarmonicCapture", &AudioProcessor::abortHarmonicCapture)
    .function("setFreqOverlapFactor", &AudioProcessor::setFreqOverlapFactor)
    .function("setRegionFrequency", &AudioProcessor::setRegionFrequency)
    .function("getRegionEnvelopeMax", &AudioProcessor::getRegionEnvelopeMax)
    .function("getRegionEnvelopeMin", &AudioProcessor::getRegionEnvelopeMin)
    .function("resetRegionEnvelopeMax", &AudioProcessor::resetRegionEnvelopeMax)
    .function("resetRegionEnvelopeMin", &AudioProcessor::resetRegionEnvelopeMin)
    .function("setRegionEnvelopeMax", &AudioProcessor::setRegionEnvelopeMax)
    .function("setRegionEnvelopeMin", &AudioProcessor::setRegionEnvelopeMin)
    .function("setRegionCentsWindow", &AudioProcessor::setRegionCentsWindow)
    .function("halveRegionDisplayEnvelope", &AudioProcessor::halveRegionDisplayEnvelope)
    .function("getRegionData", &AudioProcessor::getRegionData)
    .function("getRegionBinCount", &AudioProcessor::getRegionBinCount)
    .function("getRegionFrequencyPerBin", &AudioProcessor::getRegionFrequencyPerBin)
    .function("getRegionStartFrequency", &AudioProcessor::getRegionStartFrequency)
    .function("getRegionEndFrequency", &AudioProcessor::getRegionEndFrequency)
    .function("getRegionPeakFrequency", &AudioProcessor::getRegionPeakFrequency)
    .function("getRegionPeakMagnitude", &AudioProcessor::getRegionPeakMagnitude)
    .function("getRegionPeakConfidence", &AudioProcessor::getRegionPeakConfidence)
    .function("getRegionPeakBin", &AudioProcessor::getRegionPeakBin)
    .function("getRegionMetadata", &AudioProcessor::getRegionMetadata)
    .function("getRegionDataView", &AudioProcessor::getRegionDataView)
    .function("getStrikeState", &AudioProcessor::getStrikeState)
    .function("isInMeasurementWindow", &AudioProcessor::isInMeasurementWindow)
    .function("getStrikeMeasurement", &AudioProcessor::getStrikeMeasurement)
    .function("clearStrikeMeasurement", &AudioProcessor::clearStrikeMeasurement)
    .function("resetStrikeDetection", &AudioProcessor::resetStrikeDetection)
    .function("getStrikeMeasurementFrequency", &AudioProcessor::getStrikeMeasurementFrequency)
    .function("getStrikeMeasurementMagnitude", &AudioProcessor::getStrikeMeasurementMagnitude)
    .function("getStrikeMeasurementConfidence", &AudioProcessor::getStrikeMeasurementConfidence)
    .function("getStrikeMeasurementTimestamp", &AudioProcessor::getStrikeMeasurementTimestamp)
    .function("getStrikeMeasurementSampleCount", &AudioProcessor::getStrikeMeasurementSampleCount)
    .function("getStrikeMeasurementIsValid", &AudioProcessor::getStrikeMeasurementIsValid)
    .function("getCurrentMagnitudeThreshold", &AudioProcessor::getCurrentMagnitudeThreshold)
    .function("setStrikeDetectionTrigger", &AudioProcessor::setStrikeDetectionTrigger)
    .function("setRequiredDecayingClusters", &AudioProcessor::setRequiredDecayingClusters)
    .function("setHarmonicCaptureEnabled", &AudioProcessor::setHarmonicCaptureEnabled)
    .function("setInharmonicityB", &AudioProcessor::setInharmonicityB)
    .function("setHarmonicCaptureCallback", &AudioProcessor::setHarmonicCaptureCallback)
     .function("setStrikeStartCallback", &AudioProcessor::setStrikeStartCallback)
    .function("setHarmonicCapturePartialNumber", &AudioProcessor::setHarmonicCapturePartialNumber)
    .function("getStrikeDetectionTrigger", &AudioProcessor::getStrikeDetectionTrigger)
    .function("getRequiredDecayingClusters", &AudioProcessor::getRequiredDecayingClusters)
    ;
}

// Removed: bindings consolidated back into audio_processor.cpp for now


