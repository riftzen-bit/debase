import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function base({ size = 14, strokeWidth = 1.5, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 5.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 5.5V12a1 1 0 0 0 1 1h10l1.5-5H4.5L3 13" />
      <path d="M2 5.5V4.5a1 1 0 0 1 1-1h3.5L8 5h5a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5l1-3z" />
      <path d="M10.5 3.5 12.5 5.5" />
    </svg>
  );
}

export function ComposeIcon(props: IconProps) {
  // Square page + pencil — used for "new thread"
  return (
    <svg {...base(props)}>
      <path d="M3 3h6v3.5" />
      <path d="M3 3v10h10V8.5" />
      <path d="m9.5 8.5 4-4-2-2-4 4v2z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 4.5h10" />
      <path d="M5.5 4.5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
      <path d="M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" />
      <path d="M7 7v5M9 7v5" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="7.5" width="10" height="6" rx="1.2" />
      <path d="M5 7.5V5a3 3 0 0 1 6 0v2.5" />
    </svg>
  );
}

export function LockOpenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="7.5" width="10" height="6" rx="1.2" />
      <path d="M5 7.5V5a3 3 0 0 1 5.4-1.7" />
    </svg>
  );
}

export function BarsIcon(props: IconProps) {
  // Three bars rising left-to-right — used to indicate "effort / depth".
  return (
    <svg {...base(props)} strokeLinecap="round">
      <path d="M4 13V10M8 13V7M12 13V4" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 2.5 13.5 6.5" />
      <path d="m11 4-1.5 1.5L7 5l-3 3 4 4 3-3-.5-2.5L12 5" />
      <path d="m4 12 2-2" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function GearIcon({ size = 14, strokeWidth = 1.3, ...rest }: IconProps) {
  // Real cog: a body ring with eight short teeth and a center hole. The
  // earlier version was a small circle with eight long rays — that read as a
  // sun, not a gear, which the user (rightly) flagged.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7" />
      <path d="M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" />
      <circle cx="8" cy="8" r="3.6" />
      <circle cx="8" cy="8" r="1.3" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m13.5 13.5-3-3" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function SortIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 3v10M5 13l-2-2M5 13l2-2" />
      <path d="M11 13V3M11 3 9 5M11 3l2 2" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3 8 3.5 3.5L13 5" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.5 3.5 5.5 5.5M10.5 10.5 12.5 12.5M3.5 12.5 5.5 10.5M10.5 5.5 12.5 3.5" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 1.8 4.5 8.5h3L6.5 14.2l5-6.9h-3z" />
    </svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 3h4v4" />
      <path d="m13 3-6 6" />
      <path d="M11 9.5V13H3V5h3.5" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 8h10" />
    </svg>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />
    </svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
      <path d="M3 4v3h3" />
    </svg>
  );
}

export function PaperPlaneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 2 2 7l5 2 2 5z" />
      <path d="M14 2 7 9" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="8" height="8" rx="1" />
    </svg>
  );
}

export function FolderPlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 5.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
      <path d="M8 7.5v3M6.5 9h3" />
    </svg>
  );
}

export function CodexMark({ size = 14, ...rest }: IconProps) {
  // OpenAI's official "blossom" / hexagonal knot mark, used for the Codex
  // provider. Path data sourced from the simple-icons project (MIT-licensed
  // SVG data, OpenAI trademark retained by OpenAI). viewBox 0 0 24 24,
  // canonical solid fill — render in `currentColor` so it tones with the
  // surrounding text, just like ClaudeMark.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

export function OpenCodeMark({ size = 14, ...rest }: IconProps) {
  // OpenCode (sst/opencode.ai) brand mark. The site doesn't ship a separate
  // glyph logo — its visual identity is a pixelated 234×42 wordmark
  // "opencode" served inline. We vendor the first letter "O" of that
  // wordmark, cropped tight, retaining the duotone (lighter inner
  // highlight + darker outer ring) so the mark reads as the same brand
  // element at icon scale. Path data sourced verbatim from the inline SVG
  // at https://opencode.ai/ (light theme variant). OpenCode trademark
  // retained by sst.dev. viewBox is `-3 6 30 30` so the 24×30 "O" sits
  // centred in a 30×30 square with 3-unit horizontal margin.
  return (
    <svg
      width={size}
      height={size}
      viewBox="-3 6 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path d="M18 30H6V18H18V30Z" fill="#CFCECD" />
      <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="#656363" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  // Look-only glyph: used for "Plan" access mode where the agent drafts a
  // plan instead of executing.
  return (
    <svg {...base(props)} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

export function TasksIcon(props: IconProps) {
  // Compact checklist glyph: three short lines with a leading tick on the
  // first row. Used for the Tasks panel toggle in the composer.
  return (
    <svg {...base(props)} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3.2 4.6 1.4 1.4 2.4-2.6" strokeWidth="1.6" />
      <path d="M9 5h4" />
      <path d="M3.2 9h9.6" />
      <path d="M3.2 12.4h9.6" />
    </svg>
  );
}

export function AgentIcon(props: IconProps) {
  // Sub-agent glyph: small head + shoulders silhouette in a circle, distinct
  // from the Claude wordmark and the BrandMark. Used for Task tool blocks
  // and the running-agents indicator.
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="6.6" r="1.6" />
      <path d="M4.6 12.4c.6-1.7 1.9-2.6 3.4-2.6s2.8.9 3.4 2.6" strokeLinecap="round" />
    </svg>
  );
}

export function ArchiveIcon(props: IconProps) {
  // Storage box: lid on top, body underneath, single grip slot. Reads as
  // "tuck this away" — distinct from the trash icon which means destroy.
  return (
    <svg {...base(props)}>
      <rect x="2" y="3" width="12" height="3" rx="0.6" />
      <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
      <path d="M6.5 9h3" strokeLinecap="round" />
    </svg>
  );
}

export function RestoreIcon(props: IconProps) {
  // Counter-clockwise arrow with a dot at the start — "bring back" gesture
  // distinct from a generic refresh.
  return (
    <svg {...base(props)}>
      <path d="M3 8a5 5 0 1 0 1.4-3.5" />
      <path d="M2.5 3v3h3" />
    </svg>
  );
}

export function ClaudeMark({ size = 14, ...rest }: IconProps) {
  // Official Anthropic / Claude wordmark glyph. Path copied verbatim from
  // node_modules/@anthropic-ai/sdk/.github/logo.svg (vendored as static art),
  // canonical fill #D97757. Override via the `style` prop if a different tone
  // is needed. Do not modify the path data.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 248 248"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path
        d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z"
        fill="#D97757"
      />
    </svg>
  );
}

export function BrandMark({ size = 14, ...rest }: IconProps) {
  // App glyph for "debase". Editorial monogram: a hairline rounded-square
  // frame holds three asymmetric stacked slabs — top short and indented, mid
  // long and offset right, bottom medium — reading as page-lines being peeled
  // apart, the visual sense of "decomposing" code into tractable layers.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      {...rest}
    >
      <rect
        x="2.4"
        y="2.4"
        width="11.2"
        height="11.2"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <rect x="4.6" y="5.6" width="4.4" height="1.2" rx="0.35" fill="currentColor" />
      <rect x="5.9" y="7.4" width="5.5" height="1.2" rx="0.35" fill="currentColor" />
      <rect x="4.6" y="9.2" width="4.9" height="1.2" rx="0.35" fill="currentColor" />
      <circle cx="11.4" cy="11.6" r="0.85" fill="currentColor" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M3 11V4a1 1 0 0 1 1-1h7" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m10 4-4 4 4 4" />
    </svg>
  );
}

export function DiffIcon(props: IconProps) {
  // Two arrows nudging in opposite directions — used for diff/changes.
  return (
    <svg {...base(props)}>
      <path d="M8 2v8M5 5l3-3 3 3" />
      <path d="M8 14v-2" strokeLinecap="round" />
    </svg>
  );
}

// File-type category glyphs. Hand-drawn 16×16 to match the rest of the icon
// set. Used by `lib/fileIcons.ts` to render a tiny indicator next to file
// rows in the Changed Files tree without resorting to a 1000-file vendored
// VS Code icon pack.

export function DocumentIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6l2 2v9H4z" />
      <path d="M10 2.5v3h2" />
      <path d="M6 8h4M6 10h4M6 12h2.5" />
    </svg>
  );
}

export function CodeFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6l2 2v9H4z" />
      <path d="M10 2.5v3h2" />
      <path d="m6 11-1.5-1.5L6 8M10 8l1.5 1.5L10 11" strokeLinecap="round" />
    </svg>
  );
}

export function DataFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6l2 2v9H4z" />
      <path d="M10 2.5v3h2" />
      <path d="M6 8c-.5 0-.5 1 0 1s.5 1 0 1M10 8c.5 0 .5 1 0 1s-.5 1 0 1" strokeLinecap="round" />
    </svg>
  );
}

export function ImageFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6l2 2v9H4z" />
      <circle cx="6.5" cy="8" r="0.7" fill="currentColor" />
      <path d="m4.5 12 2-2 2 1.5L11 8.5l1 1.5" strokeLinecap="round" />
    </svg>
  );
}

export function StyleFileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6l2 2v9H4z" />
      <path d="M10 2.5v3h2" />
      <circle cx="6.5" cy="9.5" r="0.6" fill="currentColor" />
      <circle cx="9" cy="8.5" r="0.6" fill="currentColor" />
      <circle cx="9" cy="11" r="0.6" fill="currentColor" />
    </svg>
  );
}
