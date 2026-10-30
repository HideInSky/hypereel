import { useState } from "react";
import { SparkIcon } from "./Icons";

const STEPS = [
  { title: "Add your photos", text: "A character is required. Add a location and products if you want them in the shot." },
  { title: "Generate your clip", text: "Pick an effect, set the format, and let MiniMax H3 render picture and sound together." },
  { title: "Download and share", text: "Save the video, or share a link that plays right inside chat apps." },
];

/** Three-step walkthrough, shown as a small carousel. */
export default function HowItWorks() {
  const [i, setI] = useState(0);
  const go = (n: number) => setI((n + STEPS.length) % STEPS.length);
  return (
    <div className="how">
      <div className="how-card">
        {i === 0 && (
          <div className="how-demo">
            <div className="how-drop"><span className="upload-icon"><SparkIcon /></span>Drop your photos</div>
            <div className="select-pair"><div className="how-pill">Aspect Ratio <b>9:16</b></div><div className="how-pill">Resolution <b>480P</b></div></div>
          </div>
        )}
        {i === 1 && (
          <div className="how-demo">
            <div className="how-pair"><span className="how-chip">Character</span><span className="how-chip how-chip--off">Location</span></div>
            <div className="generate generate--demo"><SparkIcon /> Generate</div>
          </div>
        )}
        {i === 2 && <div className="how-demo"><div className="generate generate--demo">Download</div></div>}
      </div>
      <h2 className="how-title">{STEPS[i]!.title}</h2>
      <p className="muted">{STEPS[i]!.text}</p>
      <div className="how-nav">
        <button type="button" onClick={() => go(i - 1)} aria-label="Previous step">‹</button>
        {STEPS.map((s, n) => (
          <button key={s.title} type="button" className={`how-dot${n === i ? " how-dot--on" : ""}`} onClick={() => setI(n)} aria-label={`Step ${n + 1}: ${s.title}`}>
            {n + 1}
          </button>
        ))}
        <button type="button" onClick={() => go(i + 1)} aria-label="Next step">›</button>
      </div>
    </div>
  );
}
