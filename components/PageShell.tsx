export function PageShell({
    titleTop,
    titleBottom,
    children,
  }: {
    titleTop: string;
    titleBottom: string;
    children: React.ReactNode;
  }) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 18px 70px" }}>
        <div style={{ marginBottom: 28 }}>
          <div className="display" style={{ fontSize: 84, lineHeight: 0.85 }}>
            {titleTop}
          </div>
          <div className="display" style={{ fontSize: 84, lineHeight: 0.85 }}>
            {titleBottom}
          </div>
        </div>
  
        {children}
      </main>
    );
  }
  