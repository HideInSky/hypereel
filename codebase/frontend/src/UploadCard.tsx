import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Props = {
  title: string;
  icon: ReactNode;
  optional?: boolean;
  max: number;
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
};

const MAX_MB = 10;

/** One upload slot. Holds up to `max` photos, shown as tilted prints with a remove button. */
export default function UploadCard({ title, icon, optional, max, files, onChange, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = (incoming: FileList | null) => {
    if (!incoming) return;
    const images = [...incoming].filter((f) => f.type.startsWith("image/"));
    const tooBig = images.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) return onError(`${tooBig.name} is over ${MAX_MB} MB.`);
    if (files.length + images.length > max) onError(`${title} takes up to ${max} photo${max === 1 ? "" : "s"}.`);
    onChange([...files, ...images].slice(0, max));
  };

  return (
    <div
      className={`upload${over ? " upload--over" : ""}${files.length ? " upload--filled" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Add ${title} photos`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
    >
      {optional && <span className="upload-tag">Optional</span>}
      {files.length === 0 ? (
        <>
          <span className="upload-icon">{icon}</span>
          <strong>{title}</strong>
          <span className="upload-hint">PNG or JPG, up to {max}</span>
        </>
      ) : (
        <div className="prints">
          {urls.map((url, i) => (
            <div className="print" key={url} style={{ transform: `rotate(${i % 2 ? 4 : -4}deg)` }}>
              <img src={url} alt={`${title} ${i + 1}`} />
              <button
                type="button"
                className="print-x"
                aria-label={`Remove ${title} photo ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(files.filter((_, n) => n !== i));
                }}
              >
                ×
              </button>
            </div>
          ))}
          {files.length < max && <span className="print-add" aria-hidden="true">+</span>}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          add(e.target.files);
          e.target.value = ""; // so picking the same file again still fires
        }}
      />
    </div>
  );
}
