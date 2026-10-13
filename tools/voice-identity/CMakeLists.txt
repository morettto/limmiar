add_executable(limmiar-titanet embedding.cpp)
target_include_directories(limmiar-titanet PRIVATE ${CMAKE_SOURCE_DIR})
target_link_libraries(limmiar-titanet PRIVATE sherpa-onnx-c-api)
target_compile_options(limmiar-titanet PRIVATE -msimd128)
target_link_options(limmiar-titanet PRIVATE
    -msimd128
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createVoiceRuntime"
    "-sENVIRONMENT=web,worker,node"
    "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=268435456"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTACK_SIZE=10485760"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_voice_create','_voice_dimensions','_voice_compute','_voice_release','_voice_destroy']"
    "-sEXPORTED_RUNTIME_METHODS=['FS','HEAPF32','HEAPU8']"
)
set_target_properties(limmiar-titanet PROPERTIES SUFFIX ".js")
