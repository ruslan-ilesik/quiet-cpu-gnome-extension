cmake_minimum_required(VERSION 3.10)
project(cpuquiet)

set(CMAKE_CXX_STANDARD 17)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GLIB REQUIRED glib-2.0 gio-2.0)

add_executable(cpu-quiet-daemon cpu-quiet-daemon.cpp)
target_link_libraries(cpu-quiet-daemon ${GLIB_LIBRARIES})
target_include_directories(cpu-quiet-daemon PRIVATE ${GLIB_INCLUDE_DIRS})
target_compile_options(cpu-quiet-daemon PRIVATE ${GLIB_CFLAGS_OTHER})