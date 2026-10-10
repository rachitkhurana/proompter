import { Component, forwardRef, memo } from "react";

export const Fwd = forwardRef<HTMLButtonElement, object>((props, ref) => (
  <button ref={ref} {...props} />
));

export const Memoed = memo(function Memoed() {
  return <nav />;
});

export class Klass extends Component {
  render() {
    return <main />;
  }
}

export function helper() {
  return <em />;
}
