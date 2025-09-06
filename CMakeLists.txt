cmake_minimum_required(VERSION 3.16)
project(NativePianoTuner)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -DDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native -DNDEBUG")

# Find packages
find_package(Threads REQUIRED)
find_package(PkgConfig REQUIRED)

# Find ALSA
pkg_check_modules(ALSA REQUIRED alsa)

# Find FFTW3
pkg_check_modules(FFTW3 fftw3f)

# Main library with core DSP components and ALSA backend
add_library(tuner_core STATIC
    core/zoom_fft.cpp
    core/butterworth_filter.cpp
    core/fft/fft_utils.cpp
    platform/alsa/audio_input_alsa.cpp
    dsp/zoom_processor.cpp
)

target_include_directories(tuner_core PUBLIC 
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include/tuner
    ${ALSA_INCLUDE_DIRS}
)

if(FFTW3_FOUND)
    target_include_directories(tuner_core PUBLIC ${FFTW3_INCLUDE_DIRS})
    target_compile_definitions(tuner_core PUBLIC USE_FFTW)
    target_link_libraries(tuner_core PUBLIC ${FFTW3_LIBRARIES})
endif()

target_link_libraries(tuner_core PUBLIC 
    ${ALSA_LIBRARIES}
    Threads::Threads
    m
)

# Test executable for basic functionality
add_executable(zoom_fft_test 
    test/zoom_fft_test.cpp
)

target_link_libraries(zoom_fft_test
    tuner_core
)

# ARM-specific optimizations
if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm|aarch64")
    target_compile_options(tuner_core PRIVATE -mfpu=neon-fp-armv8)
    target_compile_definitions(tuner_core PRIVATE USE_NEON)
endif()

# Optional: ImGui-based UI executable (will add later)
# add_executable(tuner_ui
#     src/main.cpp
#     src/ui_renderer.cpp
# )

# Enable all warnings
target_compile_options(tuner_core PRIVATE -Wall -Wextra -Wpedantic)