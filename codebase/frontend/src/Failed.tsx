type Props = {
  title: string;
  message: string;
  posterUrl?: string | null;
  onRetry: () => void;
  retryLabel: string;
};

/** Friendly error screen (render failed, or the id doesn't exist). */
export default function Failed({ title, message, posterUrl, onRetry, retryLabel }: Props) {
  return (
    <section className="card failed center">
      {posterUrl && <img src={posterUrl} alt="" className="poster poster--dim poster--small" />}
      <h2 className="title">😵 {title}</h2>
      <p className="error">{message}</p>
      <button type="button" className="btn btn--primary btn--big" onClick={onRetry}>
        {retryLabel}
      </button>
    </section>
  );
}
