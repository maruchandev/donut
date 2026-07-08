import unittest

from chunking import max_tokens_for_piece, split_text


class ChunkingTests(unittest.TestCase):
    def test_short_text_single_chunk(self):
        self.assertEqual(split_text("こんにちは"), ["こんにちは"])

    def test_splits_on_newlines(self):
        text = ("あ" * 12 + "\n") * 3 + "う" * 8
        chunks = split_text(text, max_chars=20)
        self.assertEqual("".join(chunks), text)
        self.assertGreater(len(chunks), 1)

    def test_hard_wrap_without_punctuation(self):
        text = "あ" * 1200
        chunks = split_text(text, max_chars=500)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(c) <= 500 for c in chunks))

    def test_max_tokens_scales_with_length(self):
        self.assertGreater(max_tokens_for_piece("あ" * 1000), max_tokens_for_piece("あ"))

    def test_max_tokens_respects_cap(self):
        self.assertLessEqual(max_tokens_for_piece("あ" * 10000), 8192)


if __name__ == "__main__":
    unittest.main()