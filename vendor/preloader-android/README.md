# Vendored Preloader headers

Only the public headers of the LeviLauncher Android Preloader SDK are vendored
here (`include/pl/*.hpp`), taken from
<https://github.com/LiteLDev/preloader-android> (MIT). They are needed to
compile the native companion mod in `levipack/`, and committing them keeps the
build reproducible without a network fetch.

The `.git` directory of the upstream checkout is not part of this repository.
