// Host test for the companion mod's overlay JSON reader.
//
// Build and run it through scripts/check.sh, or directly:
//   g++ -std=c++20 -I tests/stubs tests/json_reader_test.cpp -o /tmp/t -pthread
//
// The reader is the only place where data from the script pack crosses into
// the native side, so it is tested against well formed frames plus the usual
// hostile inputs: truncation, wrong types, absurd counts and non-finite values.

#include <cstdio>
#include <string>
#include <vector>

// The reader lives in an anonymous namespace inside the mod, so the test pulls
// the implementation in directly with the mod's lifecycle inert.
#define STASIS_PIVOT_HOST_TEST 1
#include "../levipack/src/StasisPivot.cpp"

namespace {

int g_failures = 0;

void expect(bool condition, const char *message) {
    if (!condition) {
        std::printf("  FAIL %s\n", message);
        ++g_failures;
    } else {
        std::printf("  ok   %s\n", message);
    }
}

bool parse(const std::string &json, std::vector<stasis_pivot::DrawCommand> &out) {
    stasis_pivot::JsonReader reader(json);
    return reader.readCommands(out);
}

std::string frame(const std::string &body) {
    return std::string("{\"version\":1,\"commands\":[") + body + "]}";
}

} // namespace

int main() {
    using namespace stasis_pivot;

    std::printf("json reader\n");

    {
        std::vector<DrawCommand> commands;
        const bool ok = parse(frame(
            "{\"op\":\"rect\",\"x\":6,\"y\":6,\"w\":120.5,\"h\":30,\"color\":4160749568},"
            "{\"op\":\"line\",\"x\":0,\"y\":0,\"x3\":10,\"y3\":0,\"color\":4294967295,\"size\":2},"
            "{\"op\":\"text\",\"x\":10,\"y\":9,\"text\":\"X 120  Y 64\",\"color\":4278255615,\"size\":1}"),
            commands);
        expect(ok, "well formed frame parses");
        expect(commands.size() == 3, "three commands decoded");
        expect(commands[0].op == "rect" && commands[0].w == 120.5f, "rect geometry decoded");
        expect(commands[0].color == 0xF8000000u, "colour decoded as unsigned 32-bit");
        expect(commands[2].text == "X 120  Y 64", "text decoded");
        expect(commands[2].color == 0xFF00FFFFu, "full white-blue colour preserved");
    }

    {
        std::vector<DrawCommand> commands;
        expect(parse("{\"commands\":[]}", commands) && commands.empty(), "empty frame parses");
    }

    {
        std::vector<DrawCommand> commands;
        expect(!parse("{\"commands\":[", commands), "truncated array rejected");
        expect(!parse("", commands), "empty document rejected");
        expect(!parse("{\"other\":1}", commands), "frame without commands rejected");
        expect(!parse("{\"commands\":[{\"op\":\"rect\"", commands), "truncated object rejected");
        expect(!parse("{\"commands\":[{\"op\":7}]}", commands), "wrong value type rejected");
        expect(!parse("{\"commands\":[{\"color\":\"red\"}]}", commands), "colour as string rejected");
        expect(!parse("{\"commands\":[{\"x\":\"left\"}]}", commands), "coordinate as string rejected");
    }

    {
        std::vector<DrawCommand> commands;
        std::string huge = "{\"commands\":[";
        for (int index = 0; index < 600; ++index) {
            if (index) huge += ',';
            huge += "{\"op\":\"rect\",\"x\":1,\"y\":2,\"color\":1}";
        }
        huge += "]}";
        expect(!parse(huge, commands), "absurd command count rejected");
    }

    {
        std::vector<DrawCommand> source(2);
        source[0].op = "rect";
        source[0].x = std::nanf("");
        std::vector<pl::modmenu::DrawCommand> target;
        expect(!convert(source, target), "NaN geometry rejected by convert()");
        source[0].x = 1.0f;
        source[1].op = "text";
        source[1].x = 1e9f;
        expect(!convert(source, target), "absurd coordinate rejected by convert()");
        source[1].x = 12.0f;
        source[1].text = "hello";
        expect(convert(source, target) && target.size() == 2, "valid commands convert");
        expect(target[1].type == pl::modmenu::DrawCommandType::Text, "text maps to Text");
        expect(target[0].type == pl::modmenu::DrawCommandType::RectFilled, "rect maps to RectFilled");
    }

    {
        std::vector<DrawCommand> commands;
        expect(parse(frame("{\"op\":\"text\",\"text\":\"tab\\there\",\"color\":1}"), commands) &&
                   commands[0].text == "tab\there",
               "escapes decoded");
        expect(parse(frame(R"({"op":"text","text":"a\\b","color":1})"), commands) &&
                   commands.back().text == "a\\b",
               "backslash decoded");
        // \u00a7 is the section sign; the overlay renders ASCII only, so the
        // escape is dropped rather than producing invalid UTF-8.
        expect(parse(frame(R"({"op":"text","text":"\u00a7bAqua","color":1})"), commands) &&
                   commands.back().text == "bAqua",
               "non ASCII escape skipped safely");
    }

    if (g_failures == 0) {
        std::printf("\nall json reader tests passed\n");
        return 0;
    }
    std::printf("\n%d json reader tests failed\n", g_failures);
    return 1;
}
