# comfyui-hypereel

Viral video effects as a ComfyUI node. Pick an effect from a list, say how many images you attached, and the **hypereel Effect** node outputs a timed prompt and clip length for the MiniMax H3 reference node.

It includes the 45 built-in hypereel effects and every recipe in [`recipes/community/`](recipes/community).

## Install
Copy this folder into `ComfyUI/custom_nodes/` and restart ComfyUI. It has no dependencies. MiniMax H3 is a partner node, so you need to be signed in to your Comfy account.

Try [`workflows/hypereel_node_h3_api.json`](workflows/hypereel_node_h3_api.json): drag it in and pick a photo. Attach images to the H3 node in this order: characters, locations, products.

## Add an effect, no code
An effect is one JSON file in the open `hypereel-effect/1` format. Write one in Effect Studio on the hypereel site and download it, or write it by hand:

```json
{
  "format": "hypereel-effect/1",
  "name": "Gravity Flip",
  "description": "They fall up into the sky.",
  "seconds": 6,
  "look": "photoreal",
  "camera": "Handheld medium-wide shot of the character {place}.",
  "beats": [
    { "from": 0, "to": 2, "action": "Loose things begin to lift off the ground." },
    { "from": 2, "to": 6, "action": "Gravity reverses and the character rises into the sky." }
  ],
  "product": "The product items float up beside them.",
  "sound": "a rising hum, then soft wind."
}
```

| Field | Meaning |
|---|---|
| `seconds` | 5, 6 or 8 |
| `look` | `photoreal` or `stylized` |
| `camera` | Framing and movement. `{place}` becomes the location, or "a setting that suits the photo" if there's no location image |
| `beats` | Up to 6 timed actions |
| `product` | Used only when product images are attached |
| `sound` | H3 renders audio with the picture, so describe it here |

Drop the file into `recipes/community/` and restart ComfyUI. To share it with everyone, open a pull request. The hypereel site offers those recipes as Studio templates too.

## Tests
```bash
python3 -m unittest discover -s tests
```
These include a parity test: the node must write exactly the same prompts as the hypereel app.

If you change effects in the app, run `npm run export-recipes -w codebase/backend` from the repo root.
