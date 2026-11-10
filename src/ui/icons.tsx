/** Simple 24×24 line icons. Decorative: always aria-hidden; the button carries the name. */
import type { ComponentChildren } from "preact";

function Svg({ children, size = 24 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

/** Today: a barbell plate seen side-on. */
export const IconToday = (p: P) => (
  <Svg {...p}>
    <path d="M2 12h20M6 7v10M9 5v14M15 5v14M18 7v10" />
  </Svg>
);
/** Split: a ruled week. */
export const IconSplit = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h16M4 10h16M4 15h16M4 20h10" />
  </Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const IconCoach = (p: P) => (
  <Svg {...p}>
    <path d="M5 18.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9z" />
    <path d="M9 9h6M9 12h4" />
  </Svg>
);
export const IconMe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="M6 14l6-6 6 6" />
  </Svg>
);
export const IconDown = (p: P) => (
  <Svg {...p}>
    <path d="M6 10l6 6 6-6" />
  </Svg>
);
export const IconLeft = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </Svg>
);
export const IconRight = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
);
export const IconGrip = (p: P) => (
  <Svg {...p}>
    <path d="M5 9h14M5 15h14" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconFlame = (p: P) => (
  <Svg {...p}>
    <path d="M12 3c.5 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-4 2.6-5 .2 1.6.9 2.6 1.9 3 .2-3-.3-5.6.5-8z" />
  </Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}>
    <path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
