import styles from "./ui/styles.css?inline";

export interface ProompterProps {
  session?: { reviewer?: string };
}

/** Stub. Real implementation lands in T04+. */
export function Proompter(_props: ProompterProps): null {
  return null;
}

/** Compiled UI CSS, inlined at build time. Internal; consumed by the shadow-root host. */
export const __styles: string = styles;
