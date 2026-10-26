import { DobbyBurst, type DobbyMood } from "./DobbyBurst";

export function BrandMark({ size = 26, mood = "idle" }: { size?: number; mood?: DobbyMood }) {
  return <DobbyBurst size={size} mood={mood} />;
}
