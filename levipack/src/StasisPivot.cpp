// StasisPivot - LeviLauncher companion mod.
//
// This native mod owns two things the script pack cannot do on its own:
//
//   1. The outlined coordinate panel. LeviLauncher's Mod Menu can draw a real
//      rounded outline, arbitrary #RRGGBB colours and alpha; the overlay is fed
//      with pl::modmenu::DrawCommand primitives converted from the JSON written
//      by the pack.
//   2. The optional keybind. A Mod Menu `Keybind` config captures an Android
//      key code and forwards press/release to the mod, which triggers the
//      pivot through the pack's shared interface.
//
// It never patches libminecraftpe.so, so it keeps working across 1.26.x game
// updates as long as the Preloader (pl::) ABI does.

// pl/Mod.hpp includes pl/Logger.hpp, which includes <fmt/format.h>. The
// Preloader links fmt for its own logging, but a native mod is a separate
// library and does not get it, and this mod never calls the templated logger
// (it logs through logcat). levipack/src/fmt_shim is put on the include path
// ahead of everything else, so <fmt/format.h> resolves to a declarations-only
// stand-in there (see that file for the rules).
#include <pl/Mod.hpp>
#include <pl/ModMenu.hpp>
#include <pl/ModMenuConfig.hpp>

#include <android/log.h>

#include <cstdarg>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace stasis_pivot {

namespace {

constexpr const char *kModuleId = "stasispivot_hud";
constexpr const char *kModId = "stasis_pivot";
constexpr const char *kTag = "StasisPivot";
constexpr int kMaxCommands = 512;
constexpr float kMaxCoordinate = 100000.0f;
constexpr std::chrono::milliseconds kPollInterval{40};

// pl::log::Logger is header-only and formats through libfmt, which a native mod
// does not link; logging goes straight to logcat (the same sink) instead.
void logInfo(const char *format, ...) {
    va_list args;
    va_start(args, format);
    __android_log_vprint(ANDROID_LOG_INFO, kTag, format, args);
    va_end(args);
}

void logWarn(const char *format, ...) {
    va_list args;
    va_start(args, format);
    __android_log_vprint(ANDROID_LOG_WARN, kTag, format, args);
    va_end(args);
}

// ---------------------------------------------------------------------------
// Minimal JSON reading.
//
// The mod only consumes a tiny, well known document written by its own script
// pack (see addon/StasisPivot/scripts/levi.js), so a full parser would be dead
// weight in a shared object loaded into the game process. Anything unexpected
// is rejected and the previous frame stays on screen.
// ---------------------------------------------------------------------------

struct DrawCommand {
    std::string op;
    float x{};
    float y{};
    float w{};
    float h{};
    float x3{};
    float y3{};
    uint32_t color{};
    float size{};
    std::string text;
};

class JsonReader {
public:
    explicit JsonReader(std::string_view input) : mInput(input) {}

    bool readCommands(std::vector<DrawCommand> &out) {
        if (!consume('{')) return false;
        bool sawCommands = false;
        while (true) {
            std::string key;
            if (!readKey(key)) return false;
            if (key == "commands") {
                if (!readCommandArray(out)) return false;
                sawCommands = true;
            } else if (!skipValue()) {
                return false;
            }
            if (consume(',')) continue;
            if (consume('}')) break;
            return false;
        }
        return sawCommands;
    }

private:
    void skipSpace() {
        while (mPos < mInput.size()) {
            const char c = mInput[mPos];
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                ++mPos;
            } else {
                break;
            }
        }
    }

    bool consume(char expected) {
        skipSpace();
        if (mPos < mInput.size() && mInput[mPos] == expected) {
            ++mPos;
            return true;
        }
        return false;
    }

    bool readString(std::string &out) {
        skipSpace();
        if (mPos >= mInput.size() || mInput[mPos] != '"') return false;
        ++mPos;
        out.clear();
        while (mPos < mInput.size()) {
            const char c = mInput[mPos++];
            if (c == '"') return true;
            if (c == '\\') {
                if (mPos >= mInput.size()) return false;
                const char escape = mInput[mPos++];
                switch (escape) {
                    case 'n': out.push_back('\n'); break;
                    case 't': out.push_back('\t'); break;
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'u': {
                        // Section signs and accented names arrive as \uXXXX;
                        // the overlay only needs ASCII-safe text, so keep the
                        // code point when it fits and otherwise skip it.
                        if (mPos + 4 > mInput.size()) return false;
                        unsigned code = 0;
                        for (int i = 0; i < 4; ++i) {
                            const char digit = mInput[mPos++];
                            code <<= 4;
                            if (digit >= '0' && digit <= '9') code |= static_cast<unsigned>(digit - '0');
                            else if (digit >= 'a' && digit <= 'f') code |= static_cast<unsigned>(digit - 'a' + 10);
                            else if (digit >= 'A' && digit <= 'F') code |= static_cast<unsigned>(digit - 'A' + 10);
                            else return false;
                        }
                        if (code < 0x80) out.push_back(static_cast<char>(code));
                        break;
                    }
                    default: return false;
                }
                continue;
            }
            out.push_back(c);
        }
        return false;
    }

    bool readNumber(float &out) {
        skipSpace();
        const size_t start = mPos;
        while (mPos < mInput.size()) {
            const char c = mInput[mPos];
            if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') {
                ++mPos;
            } else {
                break;
            }
        }
        if (start == mPos) return false;
        try {
            out = std::stof(std::string(mInput.substr(start, mPos - start)));
        } catch (...) {
            return false;
        }
        return true;
    }

    bool readUint32(uint32_t &out) {
        skipSpace();
        const size_t start = mPos;
        while (mPos < mInput.size() && mInput[mPos] >= '0' && mInput[mPos] <= '9') ++mPos;
        if (start == mPos) return false;
        try {
            out = static_cast<uint32_t>(std::stoul(std::string(mInput.substr(start, mPos - start))));
        } catch (...) {
            return false;
        }
        return true;
    }

    bool readKey(std::string &key) {
        if (!readString(key)) return false;
        return consume(':');
    }

    bool skipValue() {
        skipSpace();
        if (mPos >= mInput.size()) return false;
        const char c = mInput[mPos];
        if (c == '"') {
            std::string ignored;
            return readString(ignored);
        }
        if (c == '{' || c == '[') {
            const char close = c == '{' ? '}' : ']';
            int depth = 0;
            while (mPos < mInput.size()) {
                const char current = mInput[mPos];
                if (current == '"') {
                    std::string ignored;
                    if (!readString(ignored)) return false;
                    continue;
                }
                ++mPos;
                if (current == c) ++depth;
                else if (current == close) {
                    --depth;
                    if (depth == 0) return true;
                }
            }
            return false;
        }
        float ignored = 0;
        return readNumber(ignored);
    }

    bool readCommandArray(std::vector<DrawCommand> &out) {
        if (!consume('[')) return false;
        skipSpace();
        if (consume(']')) return true;
        while (true) {
            if (out.size() >= static_cast<size_t>(kMaxCommands)) return false;
            if (!consume('{')) return false;
            DrawCommand command;
            while (true) {
                std::string key;
                if (!readKey(key)) return false;
                if (key == "op") {
                    if (!readString(command.op)) return false;
                } else if (key == "text") {
                    if (!readString(command.text)) return false;
                } else if (key == "x" || key == "y" || key == "w" || key == "h" ||
                           key == "x3" || key == "y3" || key == "size") {
                    float value = 0;
                    if (!readNumber(value)) return false;
                    if (key == "x") command.x = value;
                    else if (key == "y") command.y = value;
                    else if (key == "w") command.w = value;
                    else if (key == "h") command.h = value;
                    else if (key == "x3") command.x3 = value;
                    else if (key == "y3") command.y3 = value;
                    else command.size = value;
                } else if (key == "color") {
                    // Colours are unsigned 32-bit values, so parse the raw
                    // token rather than going through float.
                    uint32_t value = 0;
                    if (!readUint32(value)) return false;
                    command.color = value;
                } else if (!skipValue()) {
                    return false;
                }
                if (consume(',')) continue;
                if (consume('}')) break;
                return false;
            }
            out.push_back(std::move(command));
            if (consume(',')) continue;
            if (consume(']')) return true;
            return false;
        }
    }

    std::string_view mInput;
    size_t mPos{};
};

bool isFinite(float value) {
    return std::isfinite(value) && std::fabs(value) <= kMaxCoordinate;
}

pl::modmenu::DrawCommandType toType(const std::string &op) {
    if (op == "text") return pl::modmenu::DrawCommandType::Text;
    if (op == "line") return pl::modmenu::DrawCommandType::Line;
    if (op == "circle") return pl::modmenu::DrawCommandType::CircleFilled;
    return pl::modmenu::DrawCommandType::RectFilled;
}

bool convert(const std::vector<DrawCommand> &source,
             std::vector<pl::modmenu::DrawCommand> &target) {
    target.clear();
    target.reserve(source.size());
    for (const DrawCommand &command : source) {
        if (!isFinite(command.x) || !isFinite(command.y) || !isFinite(command.w) ||
            !isFinite(command.h) || !isFinite(command.x3) || !isFinite(command.y3) ||
            !isFinite(command.size)) {
            return false;
        }
        pl::modmenu::DrawCommand out;
        out.type = toType(command.op);
        out.x = command.x;
        out.y = command.y;
        out.w = command.w;
        out.h = command.h;
        out.x3 = command.x3;
        out.y3 = command.y3;
        out.color = command.color;
        out.size = command.size > 0 ? command.size : 1.0f;
        out.text = command.op == "text" ? command.text : std::string{};
        target.push_back(std::move(out));
    }
    return true;
}

} // namespace

// ---------------------------------------------------------------------------
// The mod
// ---------------------------------------------------------------------------

class StasisPivotCompanion {
public:
    static StasisPivotCompanion &instance() {
        static StasisPivotCompanion mod;
        return mod;
    }

    StasisPivotCompanion() = default;

    bool load(pl::mod::ModContext &context) {
        logInfo("loading StasisPivot companion");
        mDataDir = context.dataDir();
        mDrawPath = mDataDir / "overlay.json";
        mClearPath = mDataDir / "clear";
        std::error_code error;
        std::filesystem::create_directories(mDataDir, error);
        if (error) {
            logWarn("cannot create data directory: %s", error.message().c_str());
            return false;
        }
        return true;
    }

    bool enable(pl::mod::ModContext &context) {
        mDataDir = context.dataDir();
        if (!registerModule()) {
            logWarn("Mod Menu module registration failed");
            return false;
        }
        mEnabled.store(true, std::memory_order_relaxed);
        startWorker(context);
        return true;
    }

    bool disable() {
        mEnabled.store(false, std::memory_order_relaxed);
        stopWorker();
        publish({});
        return true;
    }

    bool unload() {
        stopWorker();
        pl::modmenu::unregisterModule(kModuleId);
        return true;
    }

private:
    bool registerModule() {
        auto builder = pl::modmenu::ModuleBuilder(kModuleId, "Stasis Pivot")
                               .description("Outlined X Y Z S coordinate panel for the StasisPivot pack.")
                               .modId(kModId)
                               .defaultEnabled(true)
                               .hideInHudEditor(false)
                               .onToggle([this](std::string_view, bool enabled) {
                                   mEnabled.store(enabled, std::memory_order_relaxed);
                                   if (!enabled) publish({});
                               })
                               .onKeybind([this](std::string_view, std::string_view key, bool isDown) {
                                   if (!isDown) return;
                                   logInfo("keybind %.*s pressed", static_cast<int>(key.size()), key.data());
                                   requestPivot();
                               })
                               .config("hudScale", "Panel scale", pl::modmenu::ConfigType::SliderFloat,
                                       "1.0", "0.5", "2.5")
                               .config("hudX", "Panel X", pl::modmenu::ConfigType::SliderInt,
                                       "6", "0", "400")
                               .config("hudY", "Panel Y", pl::modmenu::ConfigType::SliderInt,
                                       "6", "0", "400")
                               .config("triggerKey", "Trigger key", pl::modmenu::ConfigType::Keybind,
                                       "0");

        return builder.registerModule();
    }

    void startWorker(pl::mod::ModContext &context) {
        mDrawPath = context.dataDir() / "overlay.json";
        mClearPath = context.dataDir() / "clear";
        mThread = std::thread([this] {
            while (mEnabled.load(std::memory_order_relaxed)) {
                poll();
                std::this_thread::sleep_for(kPollInterval);
            }
        });
    }

    void stopWorker() {
        if (mThread.joinable()) mThread.join();
    }

    void poll() {
        std::error_code error;
        const bool clearRequested = std::filesystem::exists(mClearPath, error);
        if (clearRequested) {
            std::filesystem::remove(mClearPath, error);
            if (mHasFrame) {
                mHasFrame = false;
                publish({});
            }
            return;
        }

        // Avoid touching the file unless the pack rewrote it.
        const auto stamp = std::filesystem::last_write_time(mDrawPath, error);
        if (!error && stamp == mLastStamp) return;
        if (error) return;

        std::ifstream stream(mDrawPath, std::ios::binary);
        if (!stream) return;
        std::ostringstream buffer;
        buffer << stream.rdbuf();
        mLastStamp = stamp;

        std::vector<DrawCommand> commands;
        JsonReader reader(buffer.str());
        if (!reader.readCommands(commands)) {
            logWarn("discarding malformed overlay file");
            return;
        }
        publish(commands);
    }

    void publish(const std::vector<DrawCommand> &commands) {
        std::vector<pl::modmenu::DrawCommand> converted;
        if (!convert(commands, converted)) {
            logWarn("discarding overlay frame with invalid geometry");
            return;
        }
        pl::modmenu::submitDrawCommands(kModuleId, converted);
        mHasFrame = !converted.empty();
    }

    void requestPivot() {
        std::error_code error;
        std::ofstream flag(mClearPath.parent_path() / "trigger", std::ios::trunc);
        flag << "1";
    }

    std::filesystem::path mDataDir;
    std::atomic<bool> mEnabled{false};
    std::thread mThread;
    std::filesystem::path mDrawPath;
    std::filesystem::path mClearPath;
    std::filesystem::file_time_type mLastStamp{};
    bool mHasFrame{};
};

} // namespace stasis_pivot

#ifndef STASIS_PIVOT_HOST_TEST
PL_REGISTER_MOD(stasis_pivot::StasisPivotCompanion, stasis_pivot::StasisPivotCompanion::instance())
#endif
