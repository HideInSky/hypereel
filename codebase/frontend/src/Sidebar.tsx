import { useState } from "react";
import type { Effect, ReferenceRole } from "./api";
import UploadCard from "./UploadCard";
import { BoxIcon, PencilIcon, PersonIcon, PinIcon, SparkIcon } from "./Icons";

export const RESOLUTIONS = ["480P", "768P"];
export const ASPECT_RATIOS = ["9:16", "3:4", "1:1", "16:9"];

export type FormState = {
  uploads: Record<ReferenceRole, File[]>;
  promptOn: boolean;
  prompt: string;
  resolution: string;
  aspectRatio: string;
};

type Props = {
  effect: Effect | null;
  form: FormState;
  setForm: (next: FormState) => void;
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  onChangeEffect: () => void;
  onGenerate: () => void;
};

/** The left control panel: chosen effect, uploads, prompt, output settings, Generate. */
export default function Sidebar({ effect, form, setForm, busy, error, setError, onChangeEffect, onGenerate }: Props) {
  const [nudge, setNudge] = useState(false);
  const setUploads = (role: ReferenceRole, files: File[]) => {
    setError(null);
    setNudge(false);
    setForm({ ...form, uploads: { ...form.uploads, [role]: files } });
  };
  const ready = form.uploads.character.length > 0 && !!effect;

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="effect-card">
          {effect?.preview && <video key={effect.id} src={effect.preview} autoPlay muted loop playsInline />}
          <button type="button" className="effect-change" onClick={onChangeEffect}>
            <PencilIcon /> Change
          </button>
          <span className="effect-name">{effect?.label ?? "Loading"}</span>
        </div>

        <div className="upload-pair">
          <div className={nudge ? "shake" : undefined}>
            <UploadCard title="Character" icon={<PersonIcon />} max={4} files={form.uploads.character} onChange={(f) => setUploads("character", f)} onError={setError} />
          </div>
          <UploadCard title="Location" icon={<PinIcon />} optional max={2} files={form.uploads.location} onChange={(f) => setUploads("location", f)} onError={setError} />
        </div>
        <UploadCard title="Products" icon={<BoxIcon />} optional max={3} files={form.uploads.product} onChange={(f) => setUploads("product", f)} onError={setError} />

        <div className="field-card">
          <label className="prompt-head">
            <span>Prompt</span>
            <input
              type="checkbox"
              className="switch"
              checked={form.promptOn}
              onChange={(e) => setForm({ ...form, promptOn: e.target.checked })}
              aria-label="Toggle prompt"
            />
          </label>
          {form.promptOn && (
            <textarea
              rows={3}
              maxLength={300}
              value={form.prompt}
              placeholder="Describe your changes, e.g. make it raining, or give them a red coat"
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          )}
        </div>

        <div className="select-pair">
          <label className="field-card select-card">
            <span>Resolution</span>
            <select value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
              {RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field-card select-card">
            <span>Aspect Ratio</span>
            <select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}>
              {ASPECT_RATIOS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="sidebar-foot">
        {error && <p className="form-error" role="alert">{error}</p>}
        <button
          type="button"
          className="generate"
          disabled={busy || !effect}
          onClick={() => {
            if (!ready) {
              setError("Add at least one character photo first.");
              setNudge(true);
              return;
            }
            onGenerate();
          }}
        >
          <SparkIcon /> {busy ? "Uploading" : "Generate"}
        </button>
        <p className="rights">Only upload photos you have the right to use.</p>
      </div>
    </aside>
  );
}
