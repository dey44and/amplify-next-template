export function PageShell({
    titleTop,
    titleBottom,
    children,
  }: {
    titleTop?: string;
    titleBottom?: string;
    children: React.ReactNode;
  }) {
    const hasTitle = Boolean((titleTop && titleTop.trim()) || (titleBottom && titleBottom.trim()));
  
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 18px 70px" }}>
        {hasTitle && (
          <div style={{ marginBottom: 28 }}>
            {titleTop ? (
              <div className="display" style={{ fontSize: 84, lineHeight: 0.85 }}>
                {titleTop}
              </div>
            ) : null}
            {titleBottom ? (
              <div className="display" style={{ fontSize: 84, lineHeight: 0.85 }}>
                {titleBottom}
              </div>
            ) : null}
          </div>
        )}
  
        {children}
      </main>
    );
  }
  