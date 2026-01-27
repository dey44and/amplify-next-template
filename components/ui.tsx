export function OutlineButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { style, ...rest } = props;
  
    return (
      <button
        {...rest}
        style={{
          padding: "10px 14px",
          border: "1px solid rgba(0,0,0,0.12)",  // subtle, not harsh
          background: "#fff",                   // flat white
          color: "var(--fg)",                   // force black text
          borderRadius: 12,                     // not pill
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)", // very light lift
          transition: "transform 120ms ease, box-shadow 120ms ease",
          ...style,
        }}
        onMouseDown={(e) => {
          // micro interaction without needing CSS
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(1px)";
          rest.onMouseDown?.(e);
        }}
        onMouseUp={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
          rest.onMouseUp?.(e);
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
          rest.onMouseLeave?.(e);
        }}
      />
    );
  }
  
  
  export function Card({ children }: { children: React.ReactNode }) {
    return (
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "white",
          padding: 18,
          boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
        }}
      >
        {children}
      </section>
    );
  }
  