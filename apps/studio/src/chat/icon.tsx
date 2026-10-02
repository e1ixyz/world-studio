// Inline SVG icons shared with build mode (engine/build/icons.js). The wrapper takes no box of its
// own, so the chat's CSS styles the svg as if it were a direct child.
import { icons } from '../../../../engine/build/icons.js';

export type IconName = keyof typeof icons;
// biome-ignore lint/security/noDangerouslySetInnerHtml: the icons are fixed SVG strings from the engine
export const Icon = ({ name }: { name: IconName }) => <i style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: icons[name] }} />;
