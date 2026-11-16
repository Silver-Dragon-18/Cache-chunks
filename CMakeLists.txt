cmake_minimum_required(VERSION 3.22)
project(StasisPivotCompanion CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Android cross build for LeviLauncher (arm64-v8a):
#
#   cmake -B build -G Ninja \
#     -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
#     -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 \
#     -DANDROID_STL=c++_shared -DCMAKE_BUILD_TYPE=Release
#   cmake --build build
#
# The script pack (addon/StasisPivot) is the part that works everywhere; this
# native companion only adds the HUD overlay renderer and the keybind, and it
# requires LeviLauncher's Preloader SDK headers (vendored in
# vendor/preloader-android/include).
#
# On a non-Android host (a plain `cmake -B build && cmake --build build`, which
# is what CI's check job and anyone without the NDK would do) the library is
# built against tests/stubs so the sources are still compile-checked. Such a
# build is NOT loadable by LeviLauncher: the published .so must come from the
# Android toolchain.
if(NOT ANDROID)
    message(WARNING
        "Not an Android toolchain: building a host compile check against "
        "tests/stubs. The resulting library cannot be loaded by LeviLauncher; "
        "rebuild with the NDK toolchain file for the shippable mod.")
endif()

add_library(stasis_pivot SHARED
    levipack/src/StasisPivot.cpp
    levipack/src/preloader_stub.cpp
)

if(ANDROID)
    target_include_directories(stasis_pivot PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/vendor/preloader-android/include")
    target_link_libraries(stasis_pivot PRIVATE dl log)
    target_compile_options(stasis_pivot PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)
    target_link_options(stasis_pivot PRIVATE -Wl,--gc-sections -Wl,--exclude-libs,ALL)
else()
    target_include_directories(stasis_pivot PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/stubs")
    find_package(Threads REQUIRED)
    target_link_libraries(stasis_pivot PRIVATE Threads::Threads)
endif()

target_compile_features(stasis_pivot PRIVATE cxx_std_20)
set_target_properties(stasis_pivot PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    OUTPUT_NAME "stasis_pivot"
)

# Host-only unit tests for the overlay JSON reader (the boundary between the
# script pack and the native side).
if(NOT ANDROID)
    enable_testing()
    add_executable(json_reader_test tests/json_reader_test.cpp)
    target_include_directories(json_reader_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/tests/stubs")
    find_package(Threads REQUIRED)
    target_link_libraries(json_reader_test PRIVATE Threads::Threads)
    add_test(NAME json_reader COMMAND json_reader_test)
endif()
