import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import LibraryPicker from "./LibraryPicker";
import { itemFiles } from "./useLibrary";

type Props = {
  title: string;
  icon: ReactNode;
  optional?: boolean;
  max: number;
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
  /** Offer "From Assets" to fill the slot with saved pictures. */
  library?: boolean;
};

const MAX_MB = 10;

/** One upload slot. Holds up to `max` photos, shown as tilted prints with a remove button. */
export default function UploadCard({ title, icon, optional, max, files, onChange, onError, library }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const room = max - files.length;
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
      {library && room > 0 && (
        <button
          type="button"
          className="upload-from"
          onClick={(e) => {
            e.stopPropagation();
            setPicking(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          From Assets
        </button>
      )}
      {picking && (
        // Keep clicks and keys in the dialog from reaching this card, which would open the file chooser.
        <span className="upload-picker" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onDragOver={(e) => e.stopPropagation()} onDrop={(e) => e.stopPropagation()}>
          <LibraryPicker
            title={`${title} from Assets`}
            max={room}
            kinds={["image", "character", "sheet"]}
            confirmLabel={(n) => (n > 1 ? `Use ${n}` : "Use it")}
            note="Characters add each of their photos."
            onPick={async (items) => {
              const total = items.reduce((n, item) => n + item.images.length, 0);
              const added = await itemFiles(items, room);
              const tooBig = added.find((f) => f.size > MAX_MB * 1024 * 1024);
              if (tooBig) throw new Error(`${tooBig.name} is over ${MAX_MB} MB.`);
              onChange([...files, ...added].slice(0, max));
              setPicking(false);
              if (total > room) onError(`${title} takes up to ${max} photo${max === 1 ? "" : "s"}, so only the first ${room} ${room === 1 ? "was" : "were"} added.`);
            }}
            onClose={() => setPicking(false)}
          />
        </span>
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
