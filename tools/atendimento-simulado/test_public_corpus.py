import hashlib
import unittest
from unittest.mock import Mock, patch

from public_corpus import object_bytes


class ObjectIntegrityTest(unittest.TestCase):
    def test_checksum_verified_before_accepting_object(self):
        data = b'%PDF-1.7 example'
        digest = hashlib.md5(data).hexdigest()
        with patch('public_corpus.get', return_value=Mock(content=data)) as request:
            self.assertEqual(object_bytes(f's3://pmc-oa-opendata/PMC1.2/PMC1.2.pdf?md5={digest}'), data)
            request.assert_called_once_with('https://pmc-oa-opendata.s3.amazonaws.com/PMC1.2/PMC1.2.pdf')

    def test_bad_checksum_rejected(self):
        with patch('public_corpus.get', return_value=Mock(content=b'changed')):
            with self.assertRaisesRegex(ValueError, 'checksum'):
                object_bytes('s3://pmc-oa-opendata/a.pdf?md5=wrong')

    def test_other_hosts_rejected_without_request(self):
        with patch('public_corpus.get') as request:
            with self.assertRaisesRegex(ValueError, 'storage URL'):
                object_bytes('https://example.com/a.pdf')
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
