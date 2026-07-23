import unittest

from text_format import ensure_sentence_newlines, format_display_text, soft_clause_breaks


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

    def test_ja_clause_soft(self):
        s = soft_clause_breaks("今日はいい天気です明日も晴れます", "ja")
        self.assertIn("\n", s)
        self.assertIn("です。", s)

    def test_idempotent(self):
        s = "こんにちは。\n今日はいい天気です。"
        self.assertEqual(ensure_sentence_newlines(s), s)

    def test_format_display(self):
        s = format_display_text("テストです続きがあります", "ja")
        self.assertIn("\n", s)


if __name__ == "__main__":
    unittest.main()
