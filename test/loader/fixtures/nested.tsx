import { motion } from "framer-motion";

export function Card({ title }: { title: string }) {
  return (
    <article className="card">
      <header>
        <h2>{title}</h2>
      </header>
      <svg viewBox="0 0 10 10">
        <path d="M0 0L10 10" />
      </svg>
      <my-widget />
      <motion.div />
    </article>
  );
}
