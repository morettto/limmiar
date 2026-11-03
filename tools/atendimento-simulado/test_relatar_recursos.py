import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import relatar_recursos


class ResourceReportTest(unittest.TestCase):
    def test_zero_identified_services_still_writes_a_valid_empty_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sample = {"at": "2026-10-18T12:00:00+00:00", "services": [], "containers": [], "gpu_total_csv": None}
            (root / "amostras.jsonl").write_text(json.dumps(sample) + "\n", encoding="utf-8")
            with patch.object(relatar_recursos, "ROOT", root):
                relatar_recursos.write_reports(relatar_recursos.summarize(), root)

            report = json.loads((root / "relatorio.json").read_text(encoding="utf-8"))
            self.assertEqual(report["services"], [])
            self.assertEqual((root / "servicos.csv").read_text(encoding="utf-8-sig").splitlines(), [
                "service,samples,cpu_unit,cpu_mean,cpu_peak,rss_mean_mib,rss_peak_mib"
            ])

    def test_empty_sample_file_fails_before_writing_partial_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "amostras.jsonl").write_text("\n", encoding="utf-8")
            with patch.object(relatar_recursos, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "Nenhuma amostra"):
                    relatar_recursos.summarize()

            self.assertFalse((root / "relatorio.json").exists())
            self.assertFalse((root / "servicos.csv").exists())


if __name__ == "__main__":
    unittest.main()
