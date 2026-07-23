import unittest

# Import helpers from main without starting the app server stack more than needed.
import main as m


class BilingualJsonTests(unittest.TestCase):
    def test_parse_plain(self):
        ja, ko = m.parse_bilingual_json(
            '{"ja": "こんにちは。\\n元気ですか。", "ko": "안녕하세요.\\n잘 지내세요?"}'
        )
        self.assertIn("こんにちは", ja)
        self.assertIn("\n", ja)
        self.assertIn("안녕", ko)

    def test_parse_fenced(self):
        raw = '```json\n{"ja": "テスト", "ko": "테스트"}\n```'
        ja, ko = m.parse_bilingual_json(raw)
        self.assertEqual(ja, "テスト")
        self.assertEqual(ko, "테스트")

    def test_polished_mapping_ja_source(self):
        p, t = m.polished_and_translation("今日は晴れです。", "오늘은 맑습니다.", "ja", "今日は晴れ")
        self.assertEqual(p, "今日は晴れです。")
        self.assertEqual(t, "오늘은 맑습니다.")

    def test_polished_mapping_ko_source(self):
        p, t = m.polished_and_translation(
            "오늘은 맑아요.", "오늘은 맑습니다.", "ko", "오늘"
        )
        self.assertEqual(p, "오늘은 맑습니다.")
        self.assertEqual(t, "오늘은 맑아요.")


if __name__ == "__main__":
    unittest.main()
