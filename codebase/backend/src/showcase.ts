// The gallery opens with these effects, in this order. Each has its own cast and
// scene (see scripts/render-showcase.ts) and its own shape, which gives the gallery
// its staggered look. The clips are rendered at these ratios, so nothing gets cropped.
export const SHOWCASE: Record<string, string> = {
  canvas: "9:16",
  comic: "3:4",
  particles: "1:1",
  windows: "9:16",
  palette: "3:4",
  lsd: "1:1",
  tracking: "9:16",
  "stop-world": "3:4",
  lidar: "9:16",
};
