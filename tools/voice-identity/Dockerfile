FROM emscripten/emsdk@sha256:f174124ff798a3ead1abef247d9a849c270b642d552fea500a42565ff210f765 AS build
ARG SHERPA_REVISION=040afe360a38e25daaa325ce8889abf93ea02609
WORKDIR /work
RUN git clone https://github.com/k2-fsa/sherpa-onnx.git . && git checkout "$SHERPA_REVISION"
COPY CMakeLists.txt embedding.cpp limmiar-voice/
RUN printf '\nadd_subdirectory(limmiar-voice)\n' >> CMakeLists.txt
RUN emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DSHERPA_ONNX_ENABLE_WASM=ON \
    -DSHERPA_ONNX_ENABLE_C_API=ON -DSHERPA_ONNX_ENABLE_PYTHON=OFF \
    -DSHERPA_ONNX_ENABLE_TESTS=OFF -DSHERPA_ONNX_ENABLE_CHECK=OFF \
    -DSHERPA_ONNX_ENABLE_BINARY=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
    -DSHERPA_ONNX_ENABLE_JNI=OFF -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
    -DSHERPA_ONNX_ENABLE_GPU=OFF -DSHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY=OFF \
    && cmake --build build --target limmiar-titanet --parallel 4
FROM scratch AS assets
COPY worker.js /worker.js
COPY --from=build /work/build/bin/limmiar-titanet.js /
COPY --from=build /work/build/bin/limmiar-titanet.wasm /
