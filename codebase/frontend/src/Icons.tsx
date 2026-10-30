// Small inline icons, so the app ships no icon font.
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PersonIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5" /></svg>
);
export const PinIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const BoxIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
);
export const PencilIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" /></svg>
);
export const SparkIcon = () => (
  <svg {...base} aria-hidden="true" fill="currentColor" stroke="none"><path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2z" /></svg>
);
export const GridIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>
);
export const ClockIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const InfoIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const SearchIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} width={12} height={12} strokeWidth={3} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
