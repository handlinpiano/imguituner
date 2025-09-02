# Native Linux Piano Tuner - Technical Specification

## Project Overview

This project ports a sophisticated WebAudio-based piano tuner to native Linux, eliminating browser overhead to achieve sub-5ms latency. The core DSP algorithm uses a zoom FFT technique (heterodyne mixing + decimation) for ultra-precise frequency analysis with 0.2 cent resolution.

### Key Goals
- **Latency**: < 5ms total (audio input → frequency detection)
- **Accuracy**: ± 0.5 cents frequency resolution
- **Performance**: Real-time processing on Raspberry Pi 4
- **UI**: Responsive visualization without impacting audio performance

## Architecture Comparison

### Current WebAudio Implementation
```
Browser → Web Audio API → WASM → Zoom FFT → TypeScript UI
         (5-10ms)        (1-2ms)  (2-3ms)   (16ms frame)
```

### Native Linux Target
```
ALSA → C++ DSP → ImGui/OpenGL
(1.3ms) (<1ms)    (16ms frame, separate thread)
```

## Core DSP Technology: Zoom FFT

The zoom FFT provides high frequency resolution around specific target frequencies without the computational cost of a massive FFT. Here's how it works:

### Algorithm Steps

1. **Heterodyne Mixing**: Multiply input signal by complex exponential to shift target frequency to DC
2. **Low-Pass Filtering**: 8th-order Butterworth filter (4 cascaded biquads) for anti-aliasing
3. **Decimation**: Downsample by factor D (typically 16-32x)
4. **Windowing**: Apply Hann window to decimated signal
5. **FFT**: Compute FFT on smaller decimated signal
6. **Magnitude Extraction**: Sample magnitudes at ±120 cents around center frequency

### Mathematical Foundation

For a target frequency `f_center`:
```
Mixed signal: x_mixed[n] = x[n] * exp(-j*2π*f_center*n/fs)
Decimated bandwidth: fs/D Hz
Frequency resolution: (fs/D) / N_fft Hz
Cents resolution: 240 cents / num_bins
```

Example with typical parameters:
- Sample rate: 48000 Hz
- Decimation: 16x
- FFT size: 16384
- Output bins: 1200
- Resolution: 0.2 cents per bin

## Implementation Plan

### Phase 1: Minimal Proof of Concept

Create `zoom_fft_test.cpp` that demonstrates the core algorithm with direct ALSA input:

```cpp
// Simplified structure for initial testing
class ZoomFFT {
    int decimation = 16;
    int fft_size = 16384;
    float center_freq = 440.0;
    
    // Heterodyne oscillator state
    std::complex<float> oscillator_phase;
    
    // Butterworth filter state (4 biquads)
    std::array<BiquadState, 4> filter_sections;
    
    // Process one input buffer
    std::vector<float> process(const float* input, int size);
};
```

### Phase 2: Multi-Region Processing

Extend to handle 8 parallel regions (harmonics 1-8):

```cpp
class MultiRegionProcessor {
    std::array<ZoomFFT, 8> regions;
    
    // Configure each region for a harmonic
    void setup_for_note(float fundamental) {
        for (int i = 0; i < 8; i++) {
            regions[i].center_freq = fundamental * (i + 1);
            // Adjust decimation based on frequency
            regions[i].decimation = select_decimation(regions[i].center_freq);
        }
    }
};
```

### Phase 3: Real-time UI Integration

Add ImGui visualization on separate thread:

```cpp
class TunerApp {
    std::thread audio_thread;
    std::thread ui_thread;
    
    // Lock-free ring buffer for FFT results
    RingBuffer<FFTFrame> fft_buffer;
    
    void audio_loop() {
        while (running) {
            // Read from ALSA
            snd_pcm_readi(handle, buffer, period_size);
            
            // Process with zoom FFT
            auto result = processor.process(buffer);
            
            // Push to ring buffer (lock-free)
            fft_buffer.push(result);
        }
    }
    
    void ui_loop() {
        while (running) {
            // Get latest FFT frame
            auto frame = fft_buffer.latest();
            
            // Render with ImGui
            render_waterfall(frame);
            render_tuning_meter(frame);
        }
    }
};
```

## Performance Optimizations

### 1. SIMD Acceleration (ARM NEON)
The complex arithmetic in heterodyne mixing and filtering is perfect for NEON:
```cpp
// Scalar version
for (int i = 0; i < n; i++) {
    mixed[i] = input[i] * oscillator;
    oscillator *= phase_increment;
}

// NEON version (4x parallel)
float32x4_t osc_real = vdupq_n_f32(oscillator.real());
float32x4_t osc_imag = vdupq_n_f32(oscillator.imag());
for (int i = 0; i < n; i += 4) {
    float32x4_t in = vld1q_f32(&input[i]);
    // ... NEON complex multiply
}
```

### 2. Cache-Friendly Memory Layout
Organize data to minimize cache misses:
- Interleave real/imaginary components
- Align buffers to cache lines (64 bytes on ARM)
- Process in cache-sized chunks

### 3. Fixed-Point Filter Option
For embedded deployment, consider Q15 fixed-point for the IIR filters:
```cpp
// Float biquad: ~10 cycles/sample on Cortex-A72
// Q15 biquad: ~4 cycles/sample on Cortex-A72
```

## ALSA Configuration

### Low-Latency Setup
```cpp
// Target: 64-sample period (1.3ms @ 48kHz)
snd_pcm_hw_params_set_format(handle, params, SND_PCM_FORMAT_FLOAT_LE);
snd_pcm_hw_params_set_rate(handle, params, 48000);
snd_pcm_hw_params_set_period_size(handle, params, 64);
snd_pcm_hw_params_set_periods(handle, params, 2);  // double buffer

// For Raspberry Pi 4, may need to adjust:
// - Use plughw:0 instead of hw:0 for format conversion
// - Increase to 128 samples if USB audio adapter can't handle 64
```

### Real-time Priority
```cpp
// Request real-time scheduling for audio thread
struct sched_param param;
param.sched_priority = sched_get_priority_max(SCHED_FIFO) - 1;
pthread_setschedparam(audio_thread.native_handle(), SCHED_FIFO, &param);

// Lock memory to prevent paging
mlockall(MCL_CURRENT | MCL_FUTURE);
```

## Building and Testing

### Dependencies (Ubuntu/Debian)
```bash
# Core audio and graphics
sudo apt install libasound2-dev libgl1-mesa-dev libglfw3-dev

# Build tools
sudo apt install build-essential cmake ninja-build

# Optional: FFTW for comparison
sudo apt install libfftw3-dev

# Profiling tools
sudo apt install linux-tools-common linux-tools-generic
```

### Build System (CMake)
```cmake
cmake_minimum_required(VERSION 3.16)
project(NativePianoTuner)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native")

# Find packages
find_package(Threads REQUIRED)

# Main executable
add_executable(tuner 
    main.cpp
    zoom_fft.cpp
    audio_processor.cpp
    ui_renderer.cpp
)

# Link libraries
target_link_libraries(tuner
    asound
    GL
    glfw
    pthread
)

# ARM-specific optimizations
if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm")
    target_compile_options(tuner PRIVATE -mfpu=neon-fp-armv8)
endif()
```

### Testing Workflow

1. **Latency Verification**
   ```bash
   # Run latency test
   ./latency_test
   # Should show < 2ms per buffer with hw:0 device
   ```

2. **Accuracy Verification**
   ```bash
   # Generate test tone and verify detection
   ./accuracy_test --freq 440.0 --tolerance 0.5
   # Should detect within ±0.5 cents
   ```

3. **Performance Profiling**
   ```bash
   # Profile CPU usage
   perf record -g ./tuner
   perf report
   
   # Check for SIMD usage
   perf stat -e cycles,instructions,branches,branch-misses ./tuner
   ```

## Expected Performance Metrics

### Desktop Ubuntu (Intel i7/AMD Ryzen)
- Audio latency: < 2ms (64 samples @ 48kHz)
- Processing time per buffer: < 0.5ms
- UI frame rate: 60 FPS constant
- CPU usage: < 5% single core

### Raspberry Pi 4
- Audio latency: 2-4ms (128 samples @ 48kHz)  
- Processing time per buffer: 1-2ms
- UI frame rate: 30-60 FPS
- CPU usage: 15-25% single core

### Accuracy
- Frequency resolution: 0.2 cents
- Detection accuracy: ± 0.5 cents
- Dynamic range: 60 dB
- Harmonic detection: Up to 8th partial

## Migration Notes for Developers

### From WebAudio to Native

The existing WebAudio implementation uses several abstractions that map directly to native equivalents:

| WebAudio Component | Native Linux Equivalent |
|-------------------|------------------------|
| ScriptProcessorNode/AudioWorklet | ALSA PCM callback |
| Float32Array | std::vector<float> or raw float* |
| WebAssembly memory | Native heap |
| emscripten::val callbacks | std::function or function pointers |
| requestAnimationFrame | vsync-locked render loop |

### Key Differences

1. **Memory Management**: No WASM heap limitations. Can use full system RAM.

2. **Threading**: Real OS threads instead of Web Workers. Use std::thread with proper real-time priorities.

3. **Direct Hardware Access**: Configure audio hardware directly via ALSA instead of being limited to browser's audio context settings.

4. **No Browser Security Model**: Can use memory-mapped I/O, lock memory pages, set real-time priority.

### Reusable Components from WebAudio Version

These core algorithms translate directly:
- Zoom FFT implementation (`zoom_engine.cpp`)
- Butterworth filter coefficients
- Peak detection with parabolic interpolation  
- Envelope tracking logic
- Strike detection state machine

### Components to Rewrite

- UI layer (TypeScript → ImGui C++)
- Audio I/O (Web Audio API → ALSA)
- Thread communication (postMessage → lock-free queues)
- Settings persistence (localStorage → config file)

## Development Roadmap

### Week 1: Core Algorithm Port
- [ ] Basic ALSA audio input working
- [ ] Single-region zoom FFT processing
- [ ] Console output of detected frequency
- [ ] Verify < 5ms latency achievement

### Week 2: Multi-Region Processing  
- [ ] 8 parallel regions for harmonics
- [ ] Adaptive decimation per frequency
- [ ] Basic ImGui window with frequency display
- [ ] Performance profiling and optimization

### Week 3: Full UI Implementation
- [ ] Waterfall display with OpenGL
- [ ] Tuning meter (cents deviation)
- [ ] Strike detection visualization  
- [ ] Settings panel for audio device selection

### Week 4: Polish and Optimization
- [ ] NEON SIMD optimization (if on ARM)
- [ ] Config file for settings persistence
- [ ] Installer/packaging for distribution
- [ ] Documentation and testing

## Conclusion

This native implementation will demonstrate 5-10x latency improvement over the WebAudio version while maintaining the same sophisticated zoom FFT frequency analysis. The modular design allows testing on desktop Ubuntu before deploying to Raspberry Pi 4 for embedded use.

The key insight is that the complex DSP algorithms (zoom FFT, filters, peak detection) are already well-optimized in the WebAudio version - we're primarily eliminating layers of abstraction and overhead from the browser environment.