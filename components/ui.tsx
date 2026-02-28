export function OutlineButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, type, ...rest } = props;

  return (
    <button
      type={type ?? "button"}
      className={["ui-outline-button", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return (
    <section className={["ui-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </section>
  );
}
