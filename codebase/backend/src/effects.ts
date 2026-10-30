// The fixed set of effects. An effect is a recipe: a motion description, a clip
// length, and rules for how the uploaded references are used. The user supplies
// the "who/where/what" (character, location, products); the recipe supplies the
// "what happens". MiniMax H3's reference node receives the images in a fixed
// order, and the prompt calls them "Image 1", "Image 2"... by that order.

import { PREVIEWS } from "./previews.js";

export type ReferenceRole = "character" | "location" | "product";

export interface EffectContext {
  hasLocation: boolean;
  hasProducts: boolean;
}

export interface Effect {
  id: string;
  label: string;
  /** One line shown in the UI. */
  description: string;
  seconds: number;
  /** The effect sets its own scene, so don't ask the model to invent one from the photo. */
  ownSetting?: boolean;
  /** Deliberately not photorealistic (comic, paint...). */
  stylized?: boolean;
  /** The look depends on overlay text or numbers, so don't forbid on-screen text. */
  overlayText?: boolean;
  motion: (ctx: EffectContext) => string;
}

const PLACE = (c: EffectContext) => (c.hasLocation ? "at the location from the location image" : "in a setting that suits the photo");
const WITH_PRODUCT = (c: EffectContext, text: string) => (c.hasProducts ? ` ${text}` : "");

export const EFFECTS: Effect[] = [
  {
    id: "floating-fall",
    label: "Floating Fall",
    description: "They fall backward while their things hang in midair, and the camera glides through close-ups before the fall resumes.",
    seconds: 8,
    motion: ({ hasProducts }) => {
      const items = hasProducts
        ? "the product items from the product images, plus small personal belongings"
        : "their personal belongings, the things they would plausibly carry";
      return (
        "One continuous handheld shot. 0-2s: the character walks toward the camera in natural daylight, relaxed, then trips and tips backward, arms flung up. " +
        `2-6s: time slows to almost a freeze with the character suspended mid-fall, and ${items} drift weightlessly in the air around them, turning slowly. ` +
        "The camera glides forward past the character and passes very close to each floating item in a crisp macro close-up with shallow depth of field, the character blurred behind. " +
        "6-8s: the camera pulls back, time eases forward, and the character keeps falling in graceful slow motion. " +
        "Sound: street ambience turns muffled when time slows, soft airy whooshes as items pass the lens, a light dreamy synth note."
      );
    },
  },
  {
    id: "vanish",
    label: "Vanish",
    description: "Their body disappears in an instant, and the empty clothes collapse flat to the ground.",
    seconds: 5,
    motion: ({ hasProducts }) =>
      "Locked-off camera, no camera movement. 0-2s: the character stands fully dressed and calm, looking at the camera, with a small natural movement. " +
      "At exactly 2s their body vanishes in a single frame, with no dust, no particles, no fade and no glow. " +
      "The empty clothing keeps its shape in the air for a split second, as if still worn, then drops straight down under gravity and collapses in a flat heap of fabric on the ground" +
      (hasProducts ? ", with the product items dropping and landing on top of the clothes." : ", with any accessories landing on top.") +
      " 3-5s: the empty clothes settle, sleeves flopping, and nothing else moves. No skin or body is visible after the vanish. " +
      "Sound: quiet ambience, a soft fabric thump as the clothes land, then a beat of comic silence.",
  },
  {
    id: "eyes-in",
    label: "Eyes In",
    description: "The camera dives into their eye and through the pupil, then emerges in a whole new scene.",
    seconds: 8,
    motion: ({ hasLocation, hasProducts }) => {
      const scene = hasLocation
        ? "the location from the location image, wide and cinematic"
        : "a vast surreal dreamlike landscape that suits the character's mood";
      const product = hasProducts ? " The product items from the product images sit in that new scene as its focal point." : "";
      return (
        "One continuous unbroken camera move. 0-3s: starting on a close portrait of the character, the camera accelerates straight toward one eye. " +
        "Skin, lashes and iris fibres fill the frame in extreme macro detail, with the pupil's reflection glinting. " +
        "3-5s: the camera passes through the pupil into total darkness, with the black void rushing past and faint specks of light. " +
        `5-8s: the darkness opens seamlessly and the camera flies out into ${scene}, slowing to a gentle glide.${product} ` +
        "Sound: a low rising whoosh, a deep heartbeat inside the dark, then an airy open reverb and a soft swell of music as the new scene appears."
      );
    },
  },
  {
    id: "melting",
    label: "Melting",
    description: "They slowly melt into a glossy puddle, and their clothes stretch into liquid trails.",
    seconds: 6,
    motion: (c) =>
      `Static shot ${PLACE(c)}. 0-2s: the character stands calmly and looks down at their hands. 2-5s: their whole figure and clothing soften like warm glossy wax, stretching into smooth colorful liquid trails that run down and pool on the ground. It looks like candy-colored syrup, surreal and clean, with no anatomy, no gore and nothing frightening. 5-6s: only a shiny puddle in the colors of their outfit remains, with a final slow ripple.${WITH_PRODUCT(c, "The product items sink slowly into the puddle.")} Sound: soft wet stretching sounds, a slow dreamy synth, one final plop.`,
  },
  {
    id: "infinite-clones",
    label: "Infinite Clones",
    description: "Copy after copy of them climbs out of a tiny car and runs off in every direction.",
    seconds: 6,
    motion: (c) =>
      `Static wide-angle shot ${PLACE(c)} with one very small car parked in the center. The character gets out of the car and runs away. Immediately an identical copy climbs out and runs in another direction, then another and another, faster and faster, until dozens of identical copies are scattering across the frame in all directions while more keep coming out of the impossibly small car. Comedic timing, all copies wearing the same outfit.${WITH_PRODUCT(c, "Every copy carries the product items.")} Sound: car door slamming again and again, hurried footsteps, a bouncy comedic tune.`,
  },
  {
    id: "street-colossus",
    label: "Street Colossus",
    description: "They become a towering giant walking through a real city.",
    seconds: 6,
    ownSetting: true,
    motion: (c) =>
      `${c.hasLocation ? "Use the location image as the city." : "A sprawling modern city street."} Low-angle shot from street level. The character, enormous and taller than the surrounding buildings, walks slowly down the avenue while normal-sized cars and pedestrians move around their feet. The camera tilts up their giant figure as they pass, with atmospheric haze for true scale. Nothing is damaged and nobody is harmed.${WITH_PRODUCT(c, "They hold the product items, which are also giant.")} Sound: deep slow footstep booms, distant traffic and car horns, a swelling epic score.`,
  },
  {
    id: "earth-zoom",
    label: "Earth Zoom",
    description: "The camera plunges from orbit through the clouds and lands right in front of them.",
    seconds: 6,
    ownSetting: true,
    motion: (c) =>
      `One unbroken move with no cuts. 0-2s: from orbit, the Earth fills the frame and the camera dives straight down. 2-4s: it punches through bright clouds and rushes over a city grid, accelerating. 4-6s: it decelerates to street level and settles on the character standing ${c.hasLocation ? "at the location from the location image" : "on a city street"}, looking up into the lens.${WITH_PRODUCT(c, "They hold the product items.")} Sound: thin space ambience, roaring wind through the clouds, then a soft landing whoosh and street ambience.`,
  },
  {
    id: "monster-dab",
    label: "Monster Drop",
    description: "A colossal creature drops from the sky behind them and lands in the same style as the shot.",
    seconds: 6,
    motion: (c) =>
      `Medium-wide shot of the character ${PLACE(c)}, facing the camera and unaware. 0-2s: a shadow grows over them. 2-3s: a colossal original fantasy creature drops from the sky behind them and lands with a huge impact, throwing up dust. 3-6s: the creature rises to full height behind the character and matches their pose and attitude, then both look at the camera. The creature's color palette and texture match the character's outfit.${WITH_PRODUCT(c, "The character shows off the product items.")} Sound: rising wind, a massive ground-shaking thud, a low growl, then a confident music hit.`,
  },
  {
    id: "selfception",
    label: "Selfception",
    description: "They hold a tiny version of themselves, and the camera zooms in again and again without end.",
    seconds: 6,
    motion: (c) =>
      `Seamless continuous zoom with no cuts. The character stands ${PLACE(c)} holding a miniature identical version of themselves in their open hands. The camera pushes steadily into the miniature figure until it fills the frame and turns out to be a full-size person, holding an even smaller copy in their hands. The camera keeps pushing in and the same image repeats three times, each level identical. Sound: a hypnotic rising tone that never resolves, with a soft whoosh at each level.`,
  },
  {
    id: "frozen-in-motion",
    label: "Frozen in Motion",
    description: "They hang frozen in midair while traffic and people keep moving around them.",
    seconds: 5,
    motion: (c) =>
      `Slow arc camera move ${PLACE(c)}. The character is frozen mid-jump, feet off the ground, clothes and hair stopped mid-flutter, completely motionless like a statue. Around them, pedestrians and traffic carry on at normal speed and glance at them in passing. The character never moves.${WITH_PRODUCT(c, "The product items hang frozen in the air beside them.")} Sound: normal street ambience, footsteps and traffic, with a thin high suspended tone close to the frozen character.`,
  },
  {
    id: "animal-ride-pigeon",
    label: "Pigeon Ride",
    description: "They ride a giant pigeon down the street like it's completely normal.",
    seconds: 5,
    motion: (c) =>
      `Tracking shot moving alongside the character ${PLACE(c)}. The character confidently rides a giant realistic pigeon, sitting astride it like a horse. The pigeon struts quickly with its head bobbing, and the character bobs along with total composure. Comedic deadpan tone, realistic lighting.${WITH_PRODUCT(c, "They hold the product items while riding.")} Sound: loud cooing, flapping wings, heavy bird footsteps, a jaunty tune.`,
  },
  {
    id: "world-morphing",
    label: "World Morphing",
    description: "The whole landscape lifts and folds inward around them while they stand still.",
    seconds: 6,
    motion: (c) =>
      `Slow pull-back camera. The character stands still in the center ${PLACE(c)}. 1-5s: the ground and buildings on all sides peel upward and fold inward like paper, curving overhead until the landscape forms a vast gravity-defying enclosure around them, with streets and trees running up the walls. The character stays perfectly calm and only looks up. Sound: deep groaning stone and metal, rising orchestral swell, then a resonant quiet.`,
  },
  {
    id: "act-natural",
    label: "Act Natural",
    description: "They and the objects around them stop dead mid-action while the rest of the world keeps going.",
    seconds: 5,
    motion: (c) =>
      `Handheld shot ${PLACE(c)}. 0-1s: the character is mid-action, tossing something into the air. 1-5s: they and the objects near them stop completely mid-action, as if paused, while everyone and everything else moves on in real time. Passers-by walk around them.${WITH_PRODUCT(c, "The product items are among the objects paused in the air.")} Sound: ambience keeps playing, with a soft digital freeze click at the moment of the stop.`,
  },
  {
    id: "architecture-wave",
    label: "Architecture Wave",
    description: "They walk normally while the buildings behind them bend and ripple like liquid.",
    seconds: 6,
    motion: (c) =>
      `Steady tracking shot in front of the character walking naturally ${PLACE(c)}. Behind them, towering buildings bend, fold and ripple in a slow giant wave as if made of liquid, and the wave rolls through the skyline. The character does not notice and the ground under them stays normal. Sound: deep rolling rumble, creaking steel, a calm groove underneath.`,
  },
  {
    id: "blue-depth",
    label: "Blue Depth",
    description: "A wall of dark water fills the frame and fish drift past while everything holds still.",
    seconds: 6,
    motion: (c) =>
      `Static shot of the character ${PLACE(c)}, holding completely still. 1-2s: a wall of deep blue water rises silently from below and fills the entire frame without any splash. 2-6s: fish drift slowly past the motionless character in slow motion, with light shafts rippling across them and their hair lifting gently. Sound: everything becomes muffled and underwater, slow bubbles, a low whale-like tone.`,
  },
  {
    id: "boarding-pass",
    label: "Boarding Pass",
    description: "They walk across giant flight tickets, and each one changes their outfit and destination.",
    seconds: 8,
    ownSetting: true,
    motion: (c) =>
      `Tracking shot in front of the character walking confidently toward the camera like a runway model. A giant paper boarding pass lies across the ground ahead. Each time they step across one, the whole backdrop and their outfit change in one seamless transition: first ${c.hasLocation ? "the location from the location image" : "a tropical beach"}, then a snowy mountain village, then a neon city at night. Their face and identity stay the same.${WITH_PRODUCT(c, "They carry the product items in every scene.")} Sound: stylish upbeat beat, a jet whoosh and a paper flutter at each transition.`,
  },
  {
    id: "bullet-time",
    label: "Bullet Time",
    description: "They trip, things go flying, time freezes for a full 360° sweep, and then it all snaps back.",
    seconds: 8,
    motion: (c) =>
      `${PLACE(c)}. 0-2s: the character trips while carrying a tray, sending cups and plates flying. 2-6s: time freezes with liquid and objects suspended in midair, and the camera sweeps a smooth full 360 degrees around the frozen moment.${WITH_PRODUCT(c, "The product items hang among the flying objects, in sharp focus.")} 6-8s: everything snaps back into place in reverse, and the character stands holding the perfectly restored tray with a knowing smirk at the camera. Sound: crash starting, then a deep time-stop whoomp, airy silence during the sweep, a fast rewind and a cool music sting.`,
  },
  {
    id: "burning-man",
    label: "Burning Double",
    description: "A double of them made of fire appears and reaches out for a handshake.",
    seconds: 6,
    motion: (c) =>
      `Wide cinematic shot ${PLACE(c)}, in profile. The character faces an identical double of themselves whose whole body is made of clean bright stylized flames, a fantasy visual effect. The fire double steps forward and calmly extends a hand, and the character shakes it, completely unharmed and unbothered. Sound: a low steady roar of fire, wind, a slow dramatic guitar note. Safe for work and not violent.`,
  },
  {
    id: "clones",
    label: "Clones",
    description: "Identical copies appear around the scene and mirror them as they step toward the camera.",
    seconds: 6,
    motion: (c) =>
      `Static frontal shot ${PLACE(c)}. The character walks slowly toward the camera. Identical copies wearing the same outfit fade in one by one across the scene, at different distances, each making exactly the same movements in perfect sync.${WITH_PRODUCT(c, "Every copy holds the product items.")} Sound: a tight rhythmic beat with a new layer added as each copy appears.`,
  },
  {
    id: "cutout",
    label: "Cutout",
    description: "The surroundings break into floating paper layers, reveal a white void, and then snap back.",
    seconds: 6,
    motion: (c) =>
      `Static shot of the character ${PLACE(c)}. 1-3s: the surroundings split into flat floating cutout layers like paper collage and drift away, revealing a clean pure white void around the character, who stays fully real. 3-5s: they pose in the white void. 5-6s: the layers fly back and snap into place.${WITH_PRODUCT(c, "The product items float as cutouts beside them.")} Sound: paper rustling, a soft airy pause, then quick paper snaps.`,
  },
  {
    id: "fairytale-castle",
    label: "Fairytale Castle",
    description: "An empty field at dusk leads them to a glowing castle with fireworks overhead.",
    seconds: 8,
    ownSetting: true,
    motion: (c) =>
      `Slow rising crane shot. The character walks from behind across an empty field at dusk beside a winding stream. As the camera rises, an original glowing fairytale castle comes into view on the horizon, and fireworks bloom softly overhead. Dreamlike and painterly but photoreal.${WITH_PRODUCT(c, "They carry the product items.")} Sound: crickets, soft strings and music box, gentle distant fireworks.`,
  },
  {
    id: "high-flip",
    label: "High Flip",
    description: "The camera rises overhead and flips over, revealing a new look and place on the other side.",
    seconds: 6,
    motion: (c) =>
      `One continuous move. 0-2s: the camera follows the character ${PLACE(c)}, rising above their head. 2-3s: it flips upside down overhead through a blur of motion. 3-6s: it comes down on the other side in a completely different place and time of day, where the same person now has a different bold outfit and strikes a confident pose.${WITH_PRODUCT(c, "They hold the product items after the flip.")} Sound: a rising whoosh, a weightless beat at the top of the flip, then a heavy beat drop.`,
  },
  {
    id: "incline",
    label: "Incline",
    description: "The world tilts around them, and loose objects slide and tumble past while they stay calm.",
    seconds: 6,
    motion: (c) =>
      `Camera locked to the character ${PLACE(c)}. 1-5s: the whole world tilts steadily to one side, while the character stays upright and unfazed at a strange angle to their surroundings. Loose objects, chairs, cups and bags slide and tumble past them.${WITH_PRODUCT(c, "The product items slide by and they catch one casually.")} Sound: creaking, objects scraping and clattering, an offbeat calm tune.`,
  },
  {
    id: "lacewalker",
    label: "Lacewalker",
    description: "A tiny version of them strolls past their giant self and balances on a strap between huge bags.",
    seconds: 8,
    ownSetting: true,
    motion: (c) =>
      `Clean studio set with a soft solid backdrop. 0-3s: a miniature version of the character strolls past the giant version of the same person, who stands still. 3-8s: the miniature climbs up and balances with arms out on a thin strap stretched between two oversized ${c.hasProducts ? "product items from the product images" : "handbags"}, walking it like a tightrope. Sound: light playful pizzicato strings, tiny footsteps, a small wobble sound.`,
  },
  {
    id: "lidar",
    label: "Lidar Transition",
    description: "The scene dissolves into glowing soft fibres on black as the camera rushes through, then rebuilds somewhere new.",
    seconds: 6,
    stylized: true,
    motion: (c) =>
      `Fast forward fly-through. 0-2s: the character stands ${PLACE(c)}. 2-4s: everything, including the character, dissolves into millions of glowing soft fibres and light streaks in teal and white against pure black, like a fluffy motion-blurred laser scan, as the camera rushes through them. 4-6s: the fibres rebuild into a dramatically different real environment around the same character. Sound: a rising data whoosh, soft crackling, then a deep bass hit.`,
  },
  {
    id: "mighty-fighter",
    label: "Mighty Fighter",
    description: "They become a battle-worn knight in a misty field of red poppies.",
    seconds: 6,
    ownSetting: true,
    motion: () =>
      "Slow cinematic push-in. The character, with the same face, now wears dented and battle-worn knight's armor and stands in a misty field of red poppies at dawn, breathing slowly. Poppies sway and a torn banner moves in the wind behind them. Melancholic, painterly lighting. No blood. Sound: wind through the field, faint armor creaks, a lone cello.",
  },
  {
    id: "moonwalk",
    label: "Moonwalk",
    description: "A crowned cosmic wanderer strolls across the Moon, the Sun and the Earth.",
    seconds: 8,
    ownSetting: true,
    motion: () =>
      "Whimsical storybook surrealism, one flowing shot. The character wears a small golden crown and walks slowly across the surface of a small Moon, then steps onto a soft glowing Sun without harm, then onto a tiny blue Earth, each globe small enough to walk around, with the starfield turning behind. Sound: a music box, soft celestial choir, gentle footsteps.",
  },
  {
    id: "animal-ride-dachshund",
    label: "Dachshund Ride",
    description: "They ride a very long dachshund, which is every bit as absurd as it sounds.",
    seconds: 5,
    motion: (c) =>
      `Low tracking shot ${PLACE(c)}. The character sits with perfect posture on a giant, extremely long dachshund, trotting happily with ears flapping. Comedic deadpan tone, realistic lighting and fur.${WITH_PRODUCT(c, "They hold the product items.")} Sound: excited panting, a happy bark, quick paws, a jaunty tune.`,
  },
  {
    id: "scrapbook-collage",
    label: "Scrapbook Collage",
    description: "A full-body shot in the middle, with small inset panels of close-up details.",
    seconds: 5,
    motion: (c) =>
      `A multi-panel scrapbook layout on a paper background. The center panel shows the character full body ${PLACE(c)}, moving naturally. Smaller inset frames around it show simultaneous moving close-ups of their shoes, hands, hair and outfit details.${WITH_PRODUCT(c, "One inset panel shows the product items in close-up.")} The panels are in sync, with clean white borders and no text. Sound: a stylish lo-fi beat, soft camera shutter clicks.`,
  },
  {
    id: "smash-and-grab",
    label: "Smash and Grab",
    description: "They smash a car window, snatch the item, and make a getaway in a fast tracking shot.",
    seconds: 6,
    motion: (c) =>
      `Playful action-comedy tone. 0-2s: from inside a parked car, the camera frames ${c.hasProducts ? "the product items" : "a shiny gift box"} on the seat with the character visible through the window ${PLACE(c)}. 2-3s: the glass shatters harmlessly in slow motion and they snatch it. 3-6s: a fast tracking shot follows them sprinting away, grinning, holding it up. Sound: a tense pause, glass smash, a fast funky heist beat, running footsteps.`,
  },
  {
    id: "stop-world",
    label: "Stop World",
    description: "They snap their fingers, and the whole world stops except them.",
    seconds: 5,
    motion: (c) =>
      `Handheld shot ${PLACE(c)} with people and objects in motion. 0-2s: the character snaps their fingers. 2-5s: everything else freezes instantly, including people mid-step and birds in the air, while the character walks freely through the frozen scene and looks around.${WITH_PRODUCT(c, "They pick the product items out of the air.")} Sound: a finger snap, ambience cutting to total silence, their footsteps alone.`,
  },
  {
    id: "studio-slide",
    label: "Studio Slide",
    description: "Copies of them at different sizes and depths slide past each other against a solid backdrop.",
    seconds: 5,
    ownSetting: true,
    motion: (c) =>
      `Solid pastel studio background. Several copies of the character appear at different scales, angles and depths in the same frame, some huge and close, some small and far. They smoothly slide past one another horizontally, creating strong 3D layering.${WITH_PRODUCT(c, "Each copy holds the product items.")} Sound: a slick fashion beat with a soft swoosh for each slide.`,
  },
  {
    id: "superstar",
    label: "Superstar",
    description: "Stadium lights, raised phones, and their face on the giant screen, seen from inside the crowd.",
    seconds: 5,
    ownSetting: true,
    motion: () =>
      "Handheld shot from deep inside a huge stadium crowd at night, with a sea of raised phones and sweeping light beams. The camera pushes between people's shoulders and tilts up to reveal the character's face filling the giant stage screen. No readable text, no real performers, no logos. Sound: a roaring crowd chanting, booming bass from the stage.",
  },
  {
    id: "wild-ride",
    label: "Wild Ride",
    description: "A fast, aggressive camera orbit around them as they spin and drift.",
    seconds: 6,
    motion: (c) =>
      `High-speed controlled camera orbit around the character ${PLACE(c)} as they drift in a spinning ${c.hasProducts ? "vehicle alongside the product items" : "open car"}, with smoke coming off the tires. The camera swings from a high overhead angle down to ground level and back, always keeping them centered. No crash. Sound: screeching tires, an engine roar, a driving electronic beat.`,
  },
  {
    id: "agamemnon",
    label: "Agamemnon",
    description: "They step out of a cinema screen in armor as warriors storm the theater.",
    seconds: 6,
    ownSetting: true,
    motion: () =>
      "Inside a dark movie theater, seen from the seats. On the screen, the character in ornate bronze Greek armor walks forward and steps out of the screen into the room, larger than life. Armored warriors pour out behind them and rush down the aisles. No blood and no fighting. Sound: a huge orchestral and choir hit, marching feet, surprised gasps from the audience.",
  },
  {
    id: "masterpiece-pearl-earring",
    label: "Masterpiece: Pearl Earring",
    description: "A split screen with a 17th-century Dutch portrait below and their animated version above.",
    seconds: 5,
    ownSetting: true,
    motion: () =>
      "Vertical split screen. The bottom half shows a still public-domain style 17th-century Dutch oil portrait of a girl in a blue and yellow headscarf with a pearl earring, against a dark background. The top half shows the character recreating that exact portrait, same costume, pose and light, as a painterly living scene, slowly turning to look over their shoulder and blinking. Sound: a soft harpsichord, quiet room tone.",
  },
  {
    id: "masterpiece-fallen-angel",
    label: "Masterpiece: Fallen Angel",
    description: "A split screen with a 19th-century academic painting below and their animated version above.",
    seconds: 5,
    ownSetting: true,
    motion: () =>
      "Vertical split screen. The bottom half shows a still public-domain style 19th-century academic oil painting of a fallen angel with dark feathered wings on a rock, tearful and glaring. The top half shows the character, fully clothed in dark draped fabric, recreating that pose with large dark wings, as a living painting, with wings stirring and one tear falling. Sound: a low choir, soft wind, a single slow piano note.",
  },
  {
    id: "masterpiece-cyclops",
    label: "Masterpiece: Cyclops",
    description: "A split screen with a dreamy Symbolist painting below and their animated version above.",
    seconds: 5,
    ownSetting: true,
    motion: () =>
      "Vertical split screen. The bottom half shows a still public-domain style Symbolist oil painting of a shy one-eyed giant peeking over a mountain at a sleeping figure in a flower field. The top half shows the same dreamy painted scene brought to life, with the character as the sleeping figure in the flowers, stirring gently while the giant blinks shyly. Sound: dreamy flute, soft breeze.",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "A thick spray-paint outline around them, with marker doodles scribbled over the real scene.",
    seconds: 5,
    stylized: true,
    motion: (c) =>
      `The character moves naturally ${PLACE(c)} in a real, unaltered photographic scene. A thick rough white spray-paint outline hugs their silhouette like a sticker border and redraws slightly on every frame. Colored marker scribbles in red, green and yellow, simple graffiti shapes and childish doodles with no readable words, are drawn over the buildings and background and wiggle as they animate. Sound: spray can hiss, marker squeaks, a loose hip-hop beat.`,
  },
  {
    id: "comic",
    label: "Comic",
    description: "The whole clip becomes an inked, illustrated comic with bold shadows.",
    seconds: 5,
    stylized: true,
    motion: (c) =>
      `The character moves with energy ${PLACE(c)}. The entire clip is redrawn as a hand-illustrated graphic novel: confident black ink linework, flat cel-shaded color in a moody limited palette, hard graphic shadows and fine hatching, with small details such as leaves drifting. It looks like a printed comic panel come to life, not a filter. No speech bubbles and no text. Sound: punchy whooshes, a tense funk groove.`,
  },
  {
    id: "lsd",
    label: "Color Trip",
    description: "They turn into a cracked black-and-white photocopy while rainbow swirls warp the world around them.",
    seconds: 5,
    stylized: true,
    motion: (c) =>
      `The character poses ${PLACE(c)}. Their whole figure is rendered as a stark high-contrast black-and-white photocopy, with white skin and clothes, solid black shadows, and fine black cracks running across them like shattered porcelain. Everything else keeps normal color, with oily iridescent rainbow swirls and warped concentric ripples spreading through the background and heavy film grain. Sound: a warped tape-wobble synth, vinyl crackle, a slow heavy beat.`,
  },
  {
    id: "palette",
    label: "Palette",
    description: "The whole clip becomes thick oil paint, with brushstrokes flowing around them.",
    seconds: 5,
    stylized: true,
    motion: (c) =>
      `The character moves naturally ${PLACE(c)}. The entire clip is repainted in thick impasto oil paint, with heavy visible brushstrokes that follow the shapes of their clothes and face and swirl through the background. The strokes shift and reform on every frame, keeping the subject clearly recognizable and the colors rich. Sound: wet brush strokes, warm old-school soul loop.`,
  },
  {
    id: "particles",
    label: "Particles",
    description: "They become a glowing point cloud, a body made of thousands of tiny lights.",
    seconds: 5,
    stylized: true,
    overlayText: true,
    motion: (c) =>
      `The character moves slowly ${PLACE(c)}. Their whole body is made of thousands of tiny glowing white and cyan dots, a 3D point cloud that keeps their exact silhouette and clothing folds. The rest of the scene is dark and teal-tinted, with beams of light and dust-like particles drifting. Small sci-fi scanner labels reading "POINT CLOUD" and "SCAN ERROR" sit in the corners. Sound: shimmering digital chimes, a low hum, scanner blips.`,
  },
  {
    id: "tracking",
    label: "Tracking",
    description: "Small tracking squares, curved lines and flickering numbers lock on to every part of them.",
    seconds: 5,
    stylized: true,
    overlayText: true,
    motion: (c) =>
      `The character moves with energy ${PLACE(c)}, in a gritty real film look. A computer-vision overlay follows them: small hollow white squares lock on to their joints and clothing, thin white curved lines sweep between the squares and out of the frame, and small flickering decimal numbers such as 44.73 and -51.41 sit beside the squares. Slight digital glitch streaks. Sound: data blips, a tense electronic pulse.`,
  },
  {
    id: "windows",
    label: "Glitch Windows",
    description: "Y2K computer error screens and glitchy desktop windows burst over the shot in electric blue.",
    seconds: 5,
    stylized: true,
    overlayText: true,
    motion: (c) =>
      `The character moves naturally ${PLACE(c)}, shot like low-resolution early-2000s camcorder footage with a strong electric-blue color cast. Solid blue error-screen panels with small generic white system text, and retro desktop windows with a mouse cursor, pop up and overlap parts of the frame, tearing with glitch bars. No logos and no brand names. Sound: error beeps, a dial-up crackle, a glitchy breakbeat.`,
  },
];

// Effects that have a rendered example clip come first (see scripts/render-previews.ts).
EFFECTS.sort((a, b) => Number(PREVIEWS.includes(b.id)) - Number(PREVIEWS.includes(a.id)));

export const previewUrl = (id: string) => (PREVIEWS.includes(id) ? `/effects/${id}.mp4` : null);

export const EFFECT_IDS = EFFECTS.map((e) => e.id);

export function getEffect(id: string): Effect | undefined {
  return EFFECTS.find((e) => e.id === id);
}

/** Clean the optional user prompt so it stays one short line. */
export function sanitizeUserPrompt(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Reference images in the exact order they are attached to the H3 node. */
export interface OrderedReference {
  role: ReferenceRole;
}

/** Turns "Image 1, Image 2" position numbers into a sentence the model can follow. */
function describeRole(refs: OrderedReference[], role: ReferenceRole, text: string): string {
  const numbers = refs.flatMap((r, i) => (r.role === role ? [`Image ${i + 1}`] : []));
  if (numbers.length === 0) return "";
  const list = numbers.length === 1 ? numbers[0] : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
  return `${list} ${numbers.length === 1 ? "shows" : "show"} ${text}`;
}

/** Builds the final H3 prompt from the recipe, the reference roles and the user's note. */
export function buildEffectPrompt(effectId: string, refs: OrderedReference[], userPrompt?: string | null): string {
  const effect = getEffect(effectId);
  if (!effect) throw new Error(`Unknown effect: ${effectId}`);
  const has = (role: ReferenceRole) => refs.some((r) => r.role === role);
  const lines = [
    describeRole(refs, "character", "the character. Keep their face, build, hair and outfit exactly the same throughout."),
    describeRole(refs, "location", "the location. Set the scene there and match its light."),
    describeRole(refs, "product", "the product items. Keep their exact shape, color and details."),
    has("location") || effect.ownSetting ? "" : "Set the scene in a location that suits the character's photo.",
    effect.motion({ hasLocation: has("location"), hasProducts: has("product") }),
    sanitizeUserPrompt(userPrompt) ? `Additional direction from the user: ${sanitizeUserPrompt(userPrompt)}.` : "",
    effect.stylized ? "Cinematic and safe for work." : "Photorealistic, cinematic, safe for work.",
    effect.overlayText
      ? "The only on-screen text is the overlay described above. No subtitles, no logos, no watermark."
      : "No on-screen text, no subtitles, no logos, no watermark.",
  ];
  return lines.filter(Boolean).join(" ");
}
