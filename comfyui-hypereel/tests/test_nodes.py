"""Run from comfyui-hypereel/: python3 -m unittest discover -s tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import nodes  # noqa: E402


class Parity(unittest.TestCase):
    def test_same_prompts_as_the_app(self):
        effects = nodes.load_effects()
        cases = json.loads((ROOT / "tests" / "parity.json").read_text(encoding="utf-8"))
        self.assertGreater(len(cases), 20)
        for case in cases:
            c, l, p = case["counts"]
            with self.subTest(effect=case["effect"], counts=case["counts"]):
                self.assertEqual(nodes.build_prompt(effects[case["effect"]], c, l, p, case["direction"]), case["prompt"])


class Node(unittest.TestCase):
    def test_lists_builtin_and_community_effects(self):
        names = nodes.HypereelEffect.INPUT_TYPES()["required"]["effect"][0]
        self.assertIn("vanish", names)
        self.assertIn("gravity-flip", names)
        self.assertGreaterEqual(len(names), 48)

    def test_returns_prompt_and_seconds(self):
        prompt, seconds = nodes.HypereelEffect().build("vanish", 1, 0, 1)
        self.assertEqual(seconds, 5)
        self.assertIn("Image 2 shows the product items", prompt)

    def test_rejects_more_than_nine_images(self):
        self.assertIs(nodes.HypereelEffect.VALIDATE_INPUTS(4, 2, 3), True)
        self.assertIsInstance(nodes.HypereelEffect.VALIDATE_INPUTS(9, 1, 0), str)

    def test_a_bad_recipe_file_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            community = Path(tmp) / "community"
            community.mkdir()
            (community / "broken.json").write_text("{not json", encoding="utf-8")
            (community / "old.json").write_text('{"format": "other"}', encoding="utf-8")
            good = {"format": nodes.FORMAT, "name": "Good", "seconds": 5, "beats": [{"from": 0, "to": 5, "action": "Wave"}]}
            (community / "good.json").write_text(json.dumps(good), encoding="utf-8")
            self.assertEqual(list(nodes.load_effects(Path(tmp))), ["good"])


if __name__ == "__main__":
    unittest.main()
