import unittest

from chunk_context import (
    PREV_CHUNK_CTX,
    SpeakerChunkStore,
    build_chunk_user_content,
)


class ChunkContextTests(unittest.TestCase):
    def test_no_context_returns_text_unchanged(self):
        self.assertEqual(build_chunk_user_content([], "今日は晴れ"), "今日は晴れ")

    def test_wraps_previous_fragments(self):
        out = build_chunk_user_content(
            ["さて翻訳の", "結果を確かめ"],
            "今日の天気は",
        )
        self.assertIn("[Context 1]", out)
        self.assertIn("さて翻訳の", out)
        self.assertIn("[Context 2]", out)
        self.assertIn("結果を確かめ", out)
        self.assertIn("Translate ONLY this new fragment:", out)
        self.assertIn("今日の天気は", out)
        self.assertIn("do not translate", out.lower())

    def test_store_keeps_last_n(self):
        store = SpeakerChunkStore(maxlen=PREV_CHUNK_CTX)
        store.append("123456", "いちご", "A")
        store.append("123456", "いちご", "B")
        store.append("123456", "いちご", "C")
        store.append("123456", "いちご", "D")
        # Default PREV_CHUNK_CTX is 3 → keep last three.
        self.assertEqual(store.get_prev("123456", "いちご"), ["B", "C", "D"][-PREV_CHUNK_CTX:])
        self.assertEqual(len(store.get_prev("123456", "いちご")), PREV_CHUNK_CTX)

    def test_store_is_per_speaker(self):
        store = SpeakerChunkStore()
        store.append("123456", "A", "one")
        store.append("123456", "B", "two")
        self.assertEqual(store.get_prev("123456", "A"), ["one"])
        self.assertEqual(store.get_prev("123456", "B"), ["two"])

    def test_clear_room(self):
        store = SpeakerChunkStore()
        store.append("123456", "A", "x")
        store.append("999999", "B", "y")
        store.clear_room("123456")
        self.assertEqual(store.get_prev("123456", "A"), [])
        self.assertEqual(store.get_prev("999999", "B"), ["y"])


if __name__ == "__main__":
    unittest.main()