// Host-only stub of <jni.h>: pl/Mod.hpp only needs the type names.
#pragma once
#include <cstdint>

typedef int32_t jint;
typedef int8_t jboolean;
struct JavaVM;
struct JNIEnv;
struct _jobject;
typedef _jobject *jobject;
typedef _jobject *jstring;
typedef _jobject *jclass;
