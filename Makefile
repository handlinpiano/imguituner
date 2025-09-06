CXX = g++
CXXFLAGS = -std=c++17 -O3 -march=native -Wall -Wextra -Wpedantic -DNDEBUG
INCLUDES = -I. -I./include -I./include/tuner -I./gui -I./gui/views -I./gui/windows -I./tuning -I./dsp/analysis -I./third_party/imgui -I./third_party/imgui/backends
LIBS = -lasound -lpthread -lm

# ImGui vendored location
IMGUI_DIR = third_party/imgui

# GUI libraries for Raspberry Pi 4 (OpenGL ES 3 + EGL)
GUI_LIBS = -lglfw -lGLESv2 -lEGL -ldl
GUI_INCLUDES = -I./$(IMGUI_DIR) -I./$(IMGUI_DIR)/backends

# ImGui sources
IMGUI_SRCS = \
    $(IMGUI_DIR)/imgui.cpp \
    $(IMGUI_DIR)/imgui_draw.cpp \
    $(IMGUI_DIR)/imgui_tables.cpp \
    $(IMGUI_DIR)/imgui_widgets.cpp \
    $(IMGUI_DIR)/backends/imgui_impl_glfw.cpp \
    $(IMGUI_DIR)/backends/imgui_impl_opengl3.cpp

# Enable ImGui OpenGL ES 3 backend code paths
CXXFLAGS += -DIMGUI_IMPL_OPENGL_ES3

# Source files (new layout)
SRCS = core/zoom_fft.cpp \
       platform/alsa/audio_input_alsa.cpp \
       core/butterworth_filter.cpp \
       core/fft/fft_utils.cpp \
       core/app_settings_io.cpp \
       core/session_settings_io.cpp

# Object files
OBJS = $(SRCS:.cpp=.o)

# Test executables
TEST_TARGET = zoom_fft_test
TEST_SRC = test/zoom_fft_test.cpp
MIC_TEST_TARGET = mic_level_test
MIC_TEST_SRC = test/mic_level_test.cpp
SIMPLE_TEST_TARGET = simple_tuner_test
SIMPLE_TEST_SRC = test/simple_tuner_test.cpp
RAW_FFT_TARGET = raw_fft_test
RAW_FFT_SRC = test/raw_fft_test.cpp
BASIC_440_TARGET = basic_440_test
BASIC_440_SRC = test/basic_440_test.cpp

DIRECT_ZOOM_TARGET = direct_zoom_test
DIRECT_ZOOM_SRC = test/direct_zoom_test.cpp

TUNER_GUI_TARGET = tuner_gui
TUNER_GUI_SRC = gui/main_window.cpp
ICON_BROWSER_TARGET = icon_browser
ICON_BROWSER_SRC = gui/icon_browser.cpp
ICON_BROWSER_OBJS = gui/icon_browser.o $(IMGUI_OBJS)

# Object files for GUI
IMGUI_OBJS = $(IMGUI_SRCS:.cpp=.o)
TUNER_GUI_OBJS = gui/main_window.o \
                 gui/views/spectrum_view.o \
                 gui/views/inharmonicity_b_view.o \
                 gui/views/long_analysis_view.o \
                 gui/views/waterfall_view.o \
                 gui/views/concentric_view.o \
                 gui/windows/icon_browser_window.o \
                 tuning/notes_controller.o \
                 gui/windows/landing_page.o \
                 gui/windows/mic_setup.o \
                 gui/windows/new_session_setup.o \
                 tuning/notes_state.o \
                 gui/temperaments/loader.o \
                 gui/temperaments/compute.o \
                 dsp/analysis/octave_lock_tracker.o \
                 gui/windows/inharmonicity_window.o \
                 gui/windows/settings_window.o \
                 dsp/analysis/long_analysis_engine.o \
                 dsp/zoom_processor.o \
                 audio/AudioEngine.o \
                 platform/alsa/audio_input_alsa.o \
                 core/app_settings_io.o \
                 core/session_settings_io.o \
                 core/zoom_fft.o \
                 core/fft/fft_utils.o \
                 core/butterworth_filter.o \
                 $(IMGUI_OBJS)

# Default target
all: $(TUNER_GUI_TARGET)

# Build test executable
$(TEST_TARGET): $(OBJS) $(TEST_SRC:.cpp=.o)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LIBS)

# Build mic level test
$(MIC_TEST_TARGET): $(MIC_TEST_SRC:.cpp=.o)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LIBS)

# Build simple tuner test
$(SIMPLE_TEST_TARGET): $(OBJS) $(SIMPLE_TEST_SRC:.cpp=.o)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LIBS)

# Build basic 440 test
$(BASIC_440_TARGET): $(OBJS) $(BASIC_440_SRC:.cpp=.o)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LIBS)


# Build direct zoom test (uses audio input adapter + local zoom impl)
$(DIRECT_ZOOM_TARGET): platform/alsa/audio_input_alsa.o $(DIRECT_ZOOM_SRC:.cpp=.o)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LIBS)

# Build tuner_gui with ImGui backends (OpenGL ES 3 + GLFW)
$(TUNER_GUI_TARGET): $(TUNER_GUI_OBJS)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -o $@ $^ $(LIBS) $(GUI_LIBS)

# Build standalone icon browser
$(ICON_BROWSER_TARGET): $(ICON_BROWSER_OBJS)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -o $@ $^ $(GUI_LIBS)

# Compile core source files
%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c -o $@ $<

# Compile ImGui sources with GUI includes
$(IMGUI_DIR)/%.o: $(IMGUI_DIR)/%.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

# Compile GUI with includes
gui/main_window.o: gui/main_window.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/icon_browser.o: gui/icon_browser.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/plots/spectrum_plot.o: gui/plots/spectrum_plot.cpp gui/plots/spectrum_plot.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/plots/waterfall_plot.o: gui/plots/waterfall_plot.cpp gui/plots/waterfall_plot.hpp gui/plots/spectrum_plot.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/plots/settings_page.o: gui/plots/settings_page.cpp gui/settings_page.hpp gui/plots/spectrum_plot.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/plots/concentric_plot.o: gui/plots/concentric_plot.cpp gui/plots/concentric_plot.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/plots/long_analysis_plot.o: gui/plots/long_analysis_plot.cpp gui/plots/long_analysis_plot.hpp gui/analysis/long_analysis_engine.hpp gui/plots/spectrum_plot.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/views/concentric_view.o: gui/views/concentric_view.cpp gui/views/concentric_view.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/analysis/long_analysis_engine.o: gui/analysis/long_analysis_engine.cpp gui/analysis/long_analysis_engine.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/analysis/octave_lock_tracker.o: gui/analysis/octave_lock_tracker.cpp gui/analysis/octave_lock_tracker.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/analysis/inharmonicity_window.o: gui/analysis/inharmonicity_window.cpp gui/analysis/inharmonicity_window.hpp gui/pages/notes_state.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/pages/landing_page.o: gui/pages/landing_page.cpp gui/pages/landing_page.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/pages/new_session_setup.o: gui/pages/new_session_setup.cpp gui/pages/new_session_setup.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/pages/notes_state.o: gui/pages/notes_state.cpp gui/pages/notes_state.hpp gui/analysis/octave_lock_tracker.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/pages/notes_controller.o: gui/pages/notes_controller.cpp gui/pages/notes_controller.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/temperaments/loader.o: gui/temperaments/loader.cpp gui/temperaments/loader.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/temperaments/compute.o: gui/temperaments/compute.cpp gui/temperaments/compute.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

gui/pages/mic_setup.o: gui/pages/mic_setup.cpp gui/pages/mic_setup.hpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(GUI_INCLUDES) -c -o $@ $<

# Debug build
debug: CXXFLAGS = -std=c++17 -g -O0 -Wall -Wextra -Wpedantic -DDEBUG
debug: clean $(TEST_TARGET)

# Clean build files
clean:
	rm -f $(OBJS) $(TEST_SRC:.cpp=.o) $(MIC_TEST_SRC:.cpp=.o) $(SIMPLE_TEST_SRC:.cpp=.o) \
	      $(TEST_TARGET) $(MIC_TEST_TARGET) $(SIMPLE_TEST_TARGET) \
	      $(DIRECT_ZOOM_TARGET) $(BASIC_440_TARGET) $(TUNER_GUI_TARGET) $(ICON_BROWSER_TARGET)
	rm -f gui/*.o gui/views/*.o
	rm -f third_party/imgui/*.o third_party/imgui/backends/*.o

# Run test
run: $(TEST_TARGET)
	./$(TEST_TARGET)

# Run with sudo for realtime priority
run-rt: $(TEST_TARGET)
	sudo ./$(TEST_TARGET)

# Install dependencies (Ubuntu/Debian)
install-deps:
	sudo apt-get update && sudo apt-get install -y \
		build-essential \
		libasound2-dev \
		pkg-config

.PHONY: all clean debug run run-rt install-deps