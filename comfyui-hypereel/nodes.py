"""hypereel effects as a ComfyUI node.

Pick an effect and say how many images you attached. The node writes the prompt that
refers to them by position ("Image 1 shows the character") and gives the clip length,
ready to wire into the MiniMax H3 reference node.

It reads plain JSON from recipes/, so any effect exported from Effect Studio works:
drop the file into recipes/community/ and restart ComfyUI. No code needed.

The prompt logic mirrors codebase/backend/src/effects.ts and recipes.ts.
tests/test_nodes.py checks that both produce exactly the same text.
"""
import json
import re
from pathlib import Path

RECIPES_DIR = Path(__file__).parent / "recipes"
FORMAT = "hypereel-effect/1"
PLACE_TOKEN = "{place}"
NO_LOCATION = "in a setting that suits the photo"
WITH_LOCATION = "at the location from the location image"


def _sentence(text):
    return f"{text}." if text and text[-1] not in ".!?" else text


def compile_motion(recipe, has_location, has_products):
    """Turns a hypereel-effect/1 recipe into the timed motion text the model reads."""
    parts = [
        _sentence(recipe.get("camera", "")),
        *(f"{b['from']}-{b['to']}s: {_sentence(b['action'])}" for b in recipe["beats"]),
        _sentence(recipe.get("product", "")) if has_products else "",
    ]
    sound = recipe.get("sound", "")
    if sound:
        parts.append(f"Sound: {_sentence(sound)}")
    text = " ".join(p for p in parts if p)
    return text.replace(PLACE_TOKEN, WITH_LOCATION if has_location else NO_LOCATION)


def load_effects(recipes_dir=RECIPES_DIR):
    """Every effect by id. Community recipes can't replace a built-in effect."""
    effects = {}
    community = recipes_dir / "community"
    for path in sorted(community.glob("*.json")) if community.is_dir() else []:
        try:
            recipe = json.loads(path.read_text(encoding="utf-8"))
            if recipe.get("format") != FORMAT:
                raise ValueError(f"format should be {FORMAT}")
            effects[path.stem] = {
                "label": recipe["name"],
                "seconds": recipe["seconds"],
                "ownSetting": False,
                "stylized": recipe.get("look") == "stylized",
                "overlayText": False,
                "recipe": recipe,
            }
        except (OSError, ValueError, KeyError) as err:
            # One bad file shouldn't stop ComfyUI from loading the other effects.
            print(f"[hypereel] skipping {path.name}: {err}")
    builtin = recipes_dir / "builtin.json"
    if builtin.is_file():
        for effect in json.loads(builtin.read_text(encoding="utf-8")):
            effects[effect["id"]] = effect
    return effects


def _motion(effect, has_location, has_products):
    if "recipe" in effect:
        return compile_motion(effect["recipe"], has_location, has_products)
    key = {(False, False): "none", (True, False): "location", (False, True): "products", (True, True): "both"}
    return effect["motion"][key[(has_location, has_products)]]


def _describe(numbers, text):
    if not numbers:
        return ""
    names = [f"Image {n}" for n in numbers]
    listed = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return f"{listed} {'shows' if len(names) == 1 else 'show'} {text}"


def _clean_direction(text):
    return re.sub(r"\s+", " ", text or "").strip()[:300]


def build_prompt(effect, characters, locations=0, products=0, direction=""):
    """The final prompt. Images go in this order: characters, locations, products."""
    has_location, has_products = locations > 0, products > 0
    first_location = characters + 1
    first_product = first_location + locations
    note = _clean_direction(direction)
    lines = [
        _describe(range(1, first_location), "the character. Keep their face, build, hair and outfit exactly the same throughout."),
        _describe(range(first_location, first_product), "the location. Set the scene there and match its light."),
        _describe(range(first_product, first_product + products), "the product items. Keep their exact shape, color and details."),
        "" if has_location or effect["ownSetting"] else "Set the scene in a location that suits the character's photo.",
        _motion(effect, has_location, has_products),
        f"Additional direction from the user: {note}." if note else "",
        "Cinematic and safe for work." if effect["stylized"] else "Photorealistic, cinematic, safe for work.",
        "The only on-screen text is the overlay described above. No subtitles, no logos, no watermark."
        if effect["overlayText"]
        else "No on-screen text, no subtitles, no logos, no watermark.",
    ]
    return " ".join(line for line in lines if line)


class HypereelEffect:
    """Effect recipe in, prompt and clip length out."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "effect": (sorted(load_effects()), {"tooltip": "Built-in effects, plus any JSON in recipes/community."}),
                "character_images": ("INT", {"default": 1, "min": 1, "max": 9, "tooltip": "Attach these first on the H3 node."}),
                "location_images": ("INT", {"default": 0, "min": 0, "max": 8, "tooltip": "Attach these after the characters."}),
                "product_images": ("INT", {"default": 0, "min": 0, "max": 8, "tooltip": "Attach these last."}),
            },
            "optional": {"direction": ("STRING", {"default": "", "multiline": True, "tooltip": "Extra direction, up to 300 characters."})},
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("prompt", "seconds")
    FUNCTION = "build"
    CATEGORY = "hypereel"
    DESCRIPTION = "Writes a timed MiniMax H3 prompt from a hypereel effect recipe."

    @classmethod
    def VALIDATE_INPUTS(cls, character_images, location_images, product_images, **_):
        total = character_images + location_images + product_images
        return True if total <= 9 else f"The H3 node takes 9 images at most, and this adds up to {total}."

    def build(self, effect, character_images, location_images, product_images, direction=""):
        chosen = load_effects()[effect]
        return (build_prompt(chosen, character_images, location_images, product_images, direction), chosen["seconds"])


NODE_CLASS_MAPPINGS = {"HypereelEffect": HypereelEffect}
NODE_DISPLAY_NAME_MAPPINGS = {"HypereelEffect": "hypereel Effect"}
