import unittest

from text_format import ensure_sentence_newlines, format_display_text


class TextFormatTests(unittest.TestCase):
    def test_ensure_after_period(self):
        s = ensure_sentence_newlines("こんにちは。今日はいい天気です。")
        self.assertEqual(s, "こんにちは。\n今日はいい天気です。")

    def test_ensure_ko(self):
        s = ensure_sentence_newlines("안녕하세요.오늘 날씨가 좋네요.")
        self.assertEqual(s, "안녕하세요.\n오늘 날씨가 좋네요.")

    def test_literal_backslash_n(self):
        s = ensure_sentence_newlines("A。\\nB。")
        self.assertIn("\n", s)
        self.assertNotIn("\\n", s)

    def test_does_not_split_desuka(self):
        s = format_display_text("これは本ですか続きです。", "ja")
        self.assertNotIn("です。\nか", s)
        self.assertIn("ですか", s)
        self.assertEqual(s, "これは本ですか続きです。")

    def test_does_not_split_bare_desu(self):
        # No 。 → no forced break (AI must supply real sentence ends)
        s = format_display_text("今日はいい天気です明日も晴れます", "ja")
        self.assertEqual(s, "今日はいい天気です明日も晴れます")

    def test_idempotent(self):
        s = "こんにちは。\n今日はいい天気です。"
        self.assertEqual(ensure_sentence_newlines(s), s)


if __name__ == "__main__":
    unittest.main()
