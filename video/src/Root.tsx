import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import { Composition } from "remotion";
import { Overview, totalFrames } from "./Overview";
import { FPS } from "./theme";

export function Root() {
  return <Composition id="Overview" component={Overview} durationInFrames={totalFrames()} fps={FPS} width={1920} height={1080} />;
}
