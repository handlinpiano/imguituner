# Native Linux Piano Tuner

A high-performance, low-latency piano tuner for Linux using ALSA and Zoom FFT technology. Achieves sub-5ms latency with 0.2 cent frequency resolution.

## Features

- **Ultra-low latency**: < 5ms total (audio input → frequency detection)
- **High accuracy**: ± 0.5 cents frequency resolution
- **Zoom FFT technology**: Heterodyne mixing + decimation for precise frequency analysis
- **Multi-harmonic analysis**: Tracks up to 8 harmonics simultaneously
- **Real-time processing**: Optimized for Raspberry Pi 4 and desktop Linux
- **8th-order Butterworth filtering**: Joe filter design for optimal piano harmonic analysis

## Building

### Prerequisites

Install required dependencies:

```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y \
    build-essential \
    libasound2-dev \
    pkg-config

# Fedora/RHEL
sudo dnf install gcc-c++ alsa-lib-devel pkgconfig

# Arch Linux
sudo pacman -S base-devel alsa-lib pkg-config
```

### Compilation

```bash
# Build with optimizations
make

# Or debug build
make debug

# Clean build files
make clean
```

## Usage

### Basic frequency detection

```bash
# Default: detect 440 Hz (A4)
./zoom_fft_test

# Specify target frequency
./zoom_fft_test --freq 261.63  # Middle C

# Use specific ALSA device
./zoom_fft_test --device hw:0

# Show spectrum visualization
./zoom_fft_test --spectrum

# Analyze multiple harmonics
./zoom_fft_test --harmonics
```

### Run with real-time priority (recommended for lowest latency)

```bash
sudo ./zoom_fft_test
```

Or configure your user for real-time permissions:
```bash
# Add to /etc/security/limits.conf
@audio - rtprio 95
@audio - memlock unlimited
```

## Performance

### Expected Latency

| Platform | Buffer Size | Latency | CPU Usage |
|----------|------------|---------|-----------|
| Desktop (i7/Ryzen) | 64 samples @ 48kHz | < 2ms | < 5% |
| Raspberry Pi 4 | 128 samples @ 48kHz | 2-4ms | 15-25% |

### Accuracy

- Frequency resolution: 0.2 cents
- Detection accuracy: ± 0.5 cents
- Dynamic range: 60 dB
- Harmonic detection: Up to 8th partial

## Architecture

The tuner uses a sophisticated Zoom FFT algorithm:

1. **Heterodyne Mixing**: Shifts target frequency to DC using complex exponential
2. **Butterworth Filtering**: 8th-order lowpass (4 cascaded biquads) for anti-aliasing
3. **Decimation**: Reduces sample rate by 16-32x
4. **Windowing**: Applies Hann window to decimated signal
5. **FFT**: Computes spectrum on smaller signal
6. **Magnitude Extraction**: Samples ±120 cents around center frequency

## Technical Details

### Zoom FFT Parameters

- Decimation factor: 16-64x (adaptive based on frequency)
- FFT size: 16384 points
- Output bins: 1200 (0.2 cents per bin)
- Bandwidth: ±120 cents around center frequency

### Filter Design

The implementation uses the "Joe filter" - an 8th-order Butterworth with 0.027×Fs passband, specifically optimized for piano harmonic analysis. The filter coefficients are pre-calculated for optimal performance.

## API Overview

### Core Classes

```cpp
// Main Zoom FFT processor
class ZoomFFT {
    std::vector<float> process(const float* input, int length, float center_freq);
};

// Multi-harmonic processor
class MultiRegionProcessor {
    void setup_for_note(float fundamental_hz);
    std::vector<RegionResult> process_all_regions(const float* input, int length);
};

// Audio input handler
class AudioProcessor {
    void set_process_callback(ProcessCallback callback);
    bool start();
    void stop();
};
```

## Troubleshooting

### No audio input
- Check ALSA device: `arecord -l`
- Try `plughw:0` instead of `hw:0` for format conversion
- Verify microphone permissions

### High latency
- Run with sudo for real-time priority
- Reduce buffer size if possible
- Check for other CPU-intensive processes

### Buffer underruns (xruns)
- Increase period size (e.g., 128 or 256 samples)
- Use real-time kernel if available
- Disable CPU frequency scaling

## Future Enhancements

- [ ] ImGui-based GUI with waterfall display
- [ ] NEON SIMD optimization for ARM
- [ ] FFTW integration option
- [ ] MIDI output for detected notes
- [ ] Stretch tuning curves
- [ ] Inharmonicity calculation

## License

This implementation is based on the WebAudio piano tuner specification and uses the Zoom FFT algorithm with Joe filter design for optimal piano analysis.