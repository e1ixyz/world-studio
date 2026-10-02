// Crisp text in the world (signs, labels, titles) with troika-three-text: signed-distance-field
// glyphs that stay sharp at any distance, no font files in the game. Without `font`, troika
// picks a font that covers the text and fetches it from a CDN the first time.
import { Text } from 'troika-three-text';

export function text(str, { size = 1, color = '#ffffff', font, anchorX = 'center', anchorY = 'middle', maxWidth, align, outlineWidth, outlineColor, depthTest } = {}) {
  const t = new Text();
  t.text = String(str);
  t.fontSize = size;
  t.color = color;
  t.anchorX = anchorX;
  t.anchorY = anchorY;
  if (font) t.font = font;
  if (maxWidth != null) t.maxWidth = maxWidth;
  if (align) t.textAlign = align;
  if (outlineWidth != null) t.outlineWidth = outlineWidth;
  if (outlineColor) t.outlineColor = outlineColor;
  if (depthTest === false) t.material.depthTest = false;
  t.sync();
  return t; // a THREE.Mesh: add it to the scene; change .text and call .sync() to update
}
