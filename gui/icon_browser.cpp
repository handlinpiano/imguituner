#include <GLES3/gl3.h>
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <fstream>
#include <cstring>

static bool file_exists(const char* path) {
    std::ifstream f(path, std::ios::binary); return (bool)f;
}

static void encode_utf8(ImWchar w, char out[5]) {
    out[0]=out[1]=out[2]=out[3]=out[4]=0;
    if (w < 0x80) { out[0] = (char)w; out[1] = 0; }
    else if (w < 0x800) { out[0] = (char)(0xC0 | (w >> 6)); out[1] = (char)(0x80 | (w & 0x3F)); out[2] = 0; }
    else if (w < 0x10000) { out[0] = (char)(0xE0 | (w >> 12)); out[1] = (char)(0x80 | ((w >> 6) & 0x3F)); out[2] = (char)(0x80 | (w & 0x3F)); out[3] = 0; }
    else { out[0] = (char)(0xF0 | (w >> 18)); out[1] = (char)(0x80 | ((w >> 12) & 0x3F)); out[2] = (char)(0x80 | ((w >> 6) & 0x3F)); out[3] = (char)(0x80 | (w & 0x3F)); out[4] = 0; }
}

int main() {
    if (!glfwInit()) return 1;
    glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
    GLFWwindow* window = glfwCreateWindow(900, 700, "Icon Browser", nullptr, nullptr);
    if (!window) { glfwTerminate(); return 1; }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO(); (void)io;
    ImGui::StyleColorsDark();

    // Fonts: Roboto (if present) + MDI merged
    const char* roboto_paths[] = {
        "/usr/share/fonts/truetype/roboto/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/roboto/hinted/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/google/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    };
    const char* roboto_used = nullptr;
    for (const char* p : roboto_paths) { if (file_exists(p)) { roboto_used = p; break; } }
    if (roboto_used) io.Fonts->AddFontFromFileTTF(roboto_used, 18.0f); else io.Fonts->AddFontDefault();

    const char* mdi_paths[] = {
        "third_party/icons/MaterialIcons-Regular.ttf",
        "third_party/icons/materialdesignicons.ttf",
        "third_party/icons/MaterialDesignIconsDesktop.ttf",
    };
    const char* mdi_path = nullptr;
    for (const char* p : mdi_paths) { if (file_exists(p)) { mdi_path = p; break; } }
    ImFont* icon_font = nullptr;
    if (mdi_path) {
        ImFontConfig cfg; cfg.MergeMode = false; cfg.GlyphMinAdvanceX = 18.0f; cfg.PixelSnapH = true;
        static const ImWchar mdi_range[] = { 0xE000, 0xF8FF, 0 };
        icon_font = io.Fonts->AddFontFromFileTTF(mdi_path, 18.0f, &cfg, mdi_range);
    }

    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init("#version 300 es");

    int items_per_row = 12;
    float icon_size = 28.0f;
    static char search[32] = {0};

    while (!glfwWindowShouldClose(window)) {
        glfwPollEvents();
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        ImGui::Begin("Icon Browser");
        ImGui::Text("Roboto: %s", roboto_used ? roboto_used : "(default)");
        ImGui::Text("MDI: %s", mdi_path ? mdi_path : "(not found)");
        ImGui::InputText("Search (hex)", search, sizeof(search));
        ImGui::SliderInt("Cols", &items_per_row, 6, 24);
        ImGui::SliderFloat("Size", &icon_size, 18.0f, 48.0f, "%.0f");
        ImGui::Separator();

        if (icon_font) {
            int col = 0;
            int start_cp = 0xE000, end_cp = 0xF8FF;
            // If user entered a hex, jump near it
            if (std::strlen(search) > 0) {
                int cp = 0; std::sscanf(search, "%x", &cp);
                if (cp >= 0xE000 && cp <= 0xF8FF) { start_cp = cp; end_cp = cp + 256; if (end_cp > 0xF8FF) end_cp = 0xF8FF; }
            }
            for (int cp = start_cp; cp <= end_cp; ++cp) {
                ImWchar w = (ImWchar)cp;
                char utf8[5] = {};
                encode_utf8(w, utf8);
                ImGui::PushFont(icon_font);
                bool clicked = ImGui::Button(utf8, ImVec2(icon_size, icon_size));
                ImGui::PopFont();
                ImGui::SameLine();
                ImGui::Text("U+%04X", cp);
                if (clicked) {
                    char buf[16]; std::snprintf(buf, sizeof(buf), "U+%04X", cp);
                    ImGui::SetClipboardText(buf);
                }
                if (++col >= items_per_row) { col = 0; ImGui::NewLine(); }
            }
        } else {
            ImGui::TextUnformatted("No icon TTF found in third_party/icons/. Place materialdesignicons.ttf or MaterialDesignIconsDesktop.ttf there.");
        }

        ImGui::End();

        ImGui::Render();
        int W,H; glfwGetFramebufferSize(window,&W,&H);
        glViewport(0,0,W,H);
        glClearColor(0.1f,0.1f,0.1f,1.0f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        glfwSwapBuffers(window);
    }

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}


