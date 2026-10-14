"""Small deterministic checks for pair features and conservative calibration."""

import numpy as np

from benchmark_final100_cpu import calibrate, features, metrics
from gerar_100_falas import literal_pdf_quote, normalize


def main() -> None:
    query = np.asarray([1.0, 0.0])
    documents = np.asarray([[1.0, 0.0], [0.0, 1.0]])
    result = features(query, documents)
    np.testing.assert_array_equal(result, [[1, 0, 0, 0, 1], [0, 0, 1, 1, 0]])
    rows = [dict(positive=True, correct=True, available=True, score=0.8, judge_ms=1),
            dict(positive=False, correct=False, available=False, score=0.9, judge_ms=1)]
    threshold, measurement = calibrate(rows)
    assert threshold > 1 and not measurement["dev_gate"]
    assert metrics(rows, threshold)["emitted"] == 0
    rows[1]["score"] = 0.7
    threshold, measurement = calibrate(rows)
    assert threshold == 0.8 and measurement["precision"] == 1
    page = "Um texto com as-\nsistência e uma deﬁnição literal."
    quote = literal_pdf_quote("assistência e uma definição", page)
    assert quote in page and normalize(quote) == "assistência e uma definição"
    print("features, abstention, dev calibration and literal PDF extraction: OK")


if __name__ == "__main__":
    main()
