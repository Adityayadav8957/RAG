import { DobbyMark, type DobbyMood } from "./DobbyMark";

export function BrandMark({ size = 26, mood = "idle" }: { size?: number; mood?: DobbyMood }) {
  return <DobbyMark size={size} mood={mood} />;
}
