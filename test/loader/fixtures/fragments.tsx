export function Single() {
  return (
    <>
      <section>
        <p>one</p>
      </section>
    </>
  );
}

export function Multi() {
  return (
    <>
      <dt>term</dt>
      <dd>definition</dd>
    </>
  );
}

export const Nested = () => (
  <>
    <>
      <b>x</b>
    </>
  </>
);
