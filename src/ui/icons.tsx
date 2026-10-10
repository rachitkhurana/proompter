import type { ComponentType, ReactNode, SVGProps } from "react";
import { cx } from "./primitives/cx";

export type IconSize = "m" | "s" | "xs";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** `m` 16px (default), `s` 14px, `xs` 12px. Matches the prototype's `.ic`, `.ic.s`, `.ic.xs`. */
  size?: IconSize;
}

function createIcon(name: string, paths: ReactNode): ComponentType<IconProps> {
  function IconComponent({ size = "m", className, ...rest }: IconProps) {
    return (
      <svg
        className={cx("ic", size !== "m" && size, className)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  }
  IconComponent.displayName = name;
  return IconComponent;
}

// Every path below is copied from the `P` object in design/prototype.html.

export const LogoIcon = createIcon("LogoIcon", <path d="M8 18V6h5.5a3.5 3.5 0 0 1 0 7H8" />);
export const PickIcon = createIcon("PickIcon", <path d="M5 4.5l6.5 15 2.2-6.3L20 11z" />);
export const MultiIcon = createIcon(
  "MultiIcon",
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    <path d="M13.5 7H17a3 3 0 0 1 3 3v.5M10.5 17H7a3 3 0 0 1-3-3v-.5" />
  </>,
);
export const AreaIcon = createIcon(
  "AreaIcon",
  <path d="M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5" />,
);
export const TextIcon = createIcon("TextIcon", <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />);
export const NoteIcon = createIcon("NoteIcon", <path d="M5 5h14v10H10l-5 4z" />);
export const FreezeIcon = createIcon("FreezeIcon", <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />);
export const ResponsiveIcon = createIcon("ResponsiveIcon", <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />);
export const DesktopIcon = createIcon(
  "DesktopIcon",
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
    <path d="M9 20h6M12 16.5V20" />
  </>,
);
export const TabletIcon = createIcon(
  "TabletIcon",
  <>
    <rect x="5" y="3" width="14" height="18" rx="2.5" />
    <path d="M11 18h2" />
  </>,
);
export const MobileIcon = createIcon(
  "MobileIcon",
  <>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 18h2" />
  </>,
);
export const RotateIcon = createIcon(
  "RotateIcon",
  <>
    <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9" />
    <path d="M19.5 4v5h-5" />
    <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15" />
    <path d="M4.5 20v-5h5" />
  </>,
);
export const SearchIcon = createIcon(
  "SearchIcon",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </>,
);
export const InboxIcon = createIcon(
  "InboxIcon",
  <>
    <path d="M3.5 13.5l2.4-7.2A1.5 1.5 0 0 1 7.3 5.3h9.4a1.5 1.5 0 0 1 1.4 1L20.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />
    <path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
  </>,
);
export const XIcon = createIcon("XIcon", <path d="M17 7L7 17M7 7l10 10" />);
export const BackIcon = createIcon("BackIcon", <path d="M14.5 6l-6 6 6 6" />);
export const ChevIcon = createIcon("ChevIcon", <path d="M9.5 6l6 6-6 6" />);
export const CheckIcon = createIcon(
  "CheckIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.2l2.4 2.4 4.6-5" />
  </>,
);
/** The check without its circle. The prototype strips the circle for menu check marks. */
export const CheckMarkIcon = createIcon("CheckMarkIcon", <path d="M8.5 12.2l2.4 2.4 4.6-5" />);
export const CopyIcon = createIcon(
  "CopyIcon",
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);
export const FileIcon = createIcon(
  "FileIcon",
  <>
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
    <path d="M13.5 3.5v5h5" />
  </>,
);
export const GhIcon = createIcon(
  "GhIcon",
  <path d="M9 19c-4 1.4-4-2-5.6-2.5M15 21v-3.3a2.9 2.9 0 0 0-.8-2.2c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.2a11.4 11.4 0 0 0-6 0C6.9 1.8 5.9 2.1 5.9 2.1a4.3 4.3 0 0 0-.1 3.2 4.6 4.6 0 0 0-1.3 3.2c0 4.6 2.8 5.7 5.5 6a2.9 2.9 0 0 0-.8 2.2V21" />,
);
export const FixIcon = createIcon(
  "FixIcon",
  <path d="M14.6 6.4a4 4 0 0 0-5.3 5.3L3.8 17.2l3 3 5.5-5.5a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.3-.6-.6-2.3z" />,
);
export const ChangeIcon = createIcon(
  "ChangeIcon",
  <>
    <path d="M12.5 19.5h7" />
    <path d="M16 4.5a2.1 2.1 0 0 1 3 3L8 18.5l-4 1 1-4z" />
  </>,
);
export const QuestionIcon = createIcon(
  "QuestionIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 2.3M12 16.4h.01" />
  </>,
);
export const ApproveIcon = createIcon(
  "ApproveIcon",
  <path d="M7 11.5V19H4.5v-7.5zM7 11.5l3.5-7a2 2 0 0 1 2 2v3.5h5.4a1.6 1.6 0 0 1 1.6 1.9l-1.2 6.2a2 2 0 0 1-2 1.4H7" />,
);
export const TagIcon = createIcon(
  "TagIcon",
  <>
    <path d="M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8-9 9z" />
    <circle cx="8" cy="8" r="1.3" />
  </>,
);
export const PlanIcon = createIcon(
  "PlanIcon",
  <path d="M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2" />,
);
export const PublishIcon = createIcon(
  "PublishIcon",
  <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />,
);
export const LinkIcon = createIcon(
  "LinkIcon",
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);
export const CodeIcon = createIcon("CodeIcon", <path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5" />);
export const LayersIcon = createIcon(
  "LayersIcon",
  <>
    <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
  </>,
);
export const ClockIcon = createIcon(
  "ClockIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
export const EyeIcon = createIcon(
  "EyeIcon",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);
export const SparkleIcon = createIcon(
  "SparkleIcon",
  <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />,
);
export const DotsIcon = createIcon(
  "DotsIcon",
  <>
    <circle cx="5.5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="18.5" cy="12" r="1.2" />
  </>,
);

/** The dock's drag grip (the prototype's `GRIP`): six dots, filled rather than stroked. */
export function GripIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="2" cy="2" r="1.15" />
      <circle cx="6" cy="2" r="1.15" />
      <circle cx="2" cy="7" r="1.15" />
      <circle cx="6" cy="7" r="1.15" />
      <circle cx="2" cy="12" r="1.15" />
      <circle cx="6" cy="12" r="1.15" />
    </svg>
  );
}

/** Lookup by the prototype's `P` key, for data-driven UI (intent -> icon, viewport -> icon). */
export const icons = {
  logo: LogoIcon,
  pick: PickIcon,
  multi: MultiIcon,
  area: AreaIcon,
  text: TextIcon,
  note: NoteIcon,
  freeze: FreezeIcon,
  responsive: ResponsiveIcon,
  desktop: DesktopIcon,
  tablet: TabletIcon,
  mobile: MobileIcon,
  rotate: RotateIcon,
  search: SearchIcon,
  inbox: InboxIcon,
  x: XIcon,
  back: BackIcon,
  chev: ChevIcon,
  check: CheckIcon,
  copy: CopyIcon,
  file: FileIcon,
  gh: GhIcon,
  fix: FixIcon,
  change: ChangeIcon,
  question: QuestionIcon,
  approve: ApproveIcon,
  tag: TagIcon,
  plan: PlanIcon,
  publish: PublishIcon,
  link: LinkIcon,
  code: CodeIcon,
  layers: LayersIcon,
  clock: ClockIcon,
  eye: EyeIcon,
  sparkle: SparkleIcon,
  dots: DotsIcon,
} as const satisfies Record<string, ComponentType<IconProps>>;

export type IconName = keyof typeof icons;

export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Component = icons[name];
  return <Component {...props} />;
}
