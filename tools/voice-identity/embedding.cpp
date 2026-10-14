#include "sherpa-onnx/c-api/c-api.h"

extern "C" {

const SherpaOnnxSpeakerEmbeddingExtractor* voice_create() {
    SherpaOnnxSpeakerEmbeddingExtractorConfig config{};
    config.model = "/titanet.onnx";
    config.num_threads = 1;
    config.provider = "cpu";
    return SherpaOnnxCreateSpeakerEmbeddingExtractor(&config);
}

int voice_dimensions(const SherpaOnnxSpeakerEmbeddingExtractor* extractor) {
    return SherpaOnnxSpeakerEmbeddingExtractorDim(extractor);
}

const float* voice_compute(const SherpaOnnxSpeakerEmbeddingExtractor* extractor,
                          const float* samples, int count) {
    auto* stream = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor);
    SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, count);
    SherpaOnnxOnlineStreamInputFinished(stream);
    const float* embedding = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractor, stream);
    SherpaOnnxDestroyOnlineStream(stream);
    return embedding;
}

void voice_release(const float* embedding) {
    SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embedding);
}

void voice_destroy(const SherpaOnnxSpeakerEmbeddingExtractor* extractor) {
    SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor);
}

}
