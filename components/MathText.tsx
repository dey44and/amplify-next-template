"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

type MathTextProps = {
  text?: string | null;
  className?: string;
  style?: CSSProperties;
  inline?: boolean;
  preserveWhitespace?: boolean;
};

type MathJaxLike = {
  loader?: {
    load?: string[];
  };
  tex?: {
    inlineMath?: string[][];
    displayMath?: string[][];
    processEscapes?: boolean;
    packages?: string[] | Record<string, string[]>;
  };
  chtml?: {
    mtextInheritFont?: boolean;
    merrorInheritFont?: boolean;
    displayAlign?: "left" | "center" | "right";
    displayIndent?: string;
    linebreaks?: {
      automatic?: boolean;
      width?: string;
    };
  };
  svg?: {
    fontCache?: string;
  };
  options?: {
    skipHtmlTags?: string[];
  };
  startup?: {
    typeset?: boolean;
  };
  typesetClear?: (elements?: HTMLElement[]) => void;
  typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
};

declare global {
  interface Window {
    MathJax?: MathJaxLike;
    __mathJaxConfigured?: boolean;
    __mathJaxLoadingPromise?: Promise<void>;
  }
}

const MATHJAX_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";

function configureMathJax() {
  if (typeof window === "undefined") return;
  if (window.__mathJaxConfigured) return;

  const current = window.MathJax ?? {};

  window.MathJax = {
    ...current,
    loader: {
      ...current.loader,
      load: Array.from(
        new Set([...(current.loader?.load ?? []), "[tex]/textmacros"])
      ),
    },
    tex: {
      ...current.tex,
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
      ],
      processEscapes: true,
      packages:
        current.tex?.packages && !Array.isArray(current.tex.packages)
          ? {
              ...current.tex.packages,
              "[+]": Array.from(
                new Set([
                  ...((current.tex.packages["[+]"] as string[] | undefined) ??
                    []),
                  "textmacros",
                ])
              ),
            }
          : { "[+]": ["textmacros"] },
    },
    chtml: {
      ...current.chtml,
      mtextInheritFont: true,
      merrorInheritFont: true,
      displayAlign: "left",
      displayIndent: "0",
      linebreaks: {
        ...(current.chtml?.linebreaks ?? {}),
        automatic: true,
        width: "container",
      },
    },
    svg: {
      ...current.svg,
      fontCache: "global",
    },
    options: {
      ...current.options,
      skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    },
    startup: {
      ...current.startup,
      typeset: false,
    },
  };

  window.__mathJaxConfigured = true;
}

function ensureMathJaxLoaded() {
  if (typeof window === "undefined") return Promise.resolve();
  if (typeof window.MathJax?.typesetPromise === "function") {
    return Promise.resolve();
  }

  configureMathJax();

  if (window.__mathJaxLoadingPromise) {
    return window.__mathJaxLoadingPromise;
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[data-mathjax-loader="true"]'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      if (typeof window.MathJax?.typesetPromise === "function") {
        resolve();
        return;
      }

      const pollId = window.setInterval(() => {
        if (typeof window.MathJax?.typesetPromise === "function") {
          window.clearInterval(pollId);
          window.clearTimeout(timeoutId);
          resolve();
        }
      }, 50);

      const timeoutId = window.setTimeout(() => {
        window.clearInterval(pollId);
        reject(new Error("Timed out waiting for MathJax."));
      }, 15000);

      existingScript.addEventListener(
        "load",
        () => {
          window.clearInterval(pollId);
          window.clearTimeout(timeoutId);
          resolve();
        },
        { once: true }
      );
      existingScript.addEventListener(
        "error",
        () => {
          window.clearInterval(pollId);
          window.clearTimeout(timeoutId);
          reject(new Error("Failed to load MathJax."));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = MATHJAX_SCRIPT_URL;
    script.async = true;
    script.dataset.mathjaxLoader = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load MathJax."));
    document.head.appendChild(script);
  });

  // If loading fails once (slow network/CDN hiccup), allow future calls to retry.
  window.__mathJaxLoadingPromise = loadPromise.catch((err) => {
    window.__mathJaxLoadingPromise = undefined;
    throw err;
  });

  return window.__mathJaxLoadingPromise;
}

export function MathText({
  text,
  className,
  style,
  inline = false,
  preserveWhitespace = true,
}: MathTextProps) {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    const typesetNode = async () => {
      await ensureMathJaxLoaded();
      if (cancelled) return;

      const node = rootRef.current;
      if (!node) return;

      const mathJax = window.MathJax;
      if (typeof mathJax?.typesetPromise !== "function") {
        throw new Error("MathJax API unavailable after script load.");
      }

      mathJax.typesetClear?.([node]);
      await mathJax.typesetPromise([node]);
    };

    typesetNode().catch((err) => {
      if (cancelled) return;
      console.error("MathJax load/typeset error:", err);

      // One delayed retry for transient script-load races.
      retryTimer = window.setTimeout(() => {
        typesetNode().catch((retryErr) => {
          if (cancelled) return;
          console.error("MathJax retry failed:", retryErr);
        });
      }, 1200);
    });

    return () => {
      cancelled = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [inline, text]);

  const mergedClassName = [inline ? "math-text-inline" : "math-text", className]
    .filter(Boolean)
    .join(" ");

  const mergedStyle: CSSProperties = {
    ...(inline
      ? { display: "inline" }
      : {
          whiteSpace: preserveWhitespace ? "pre-wrap" : "normal",
          lineHeight: 1.5,
        }),
    ...style,
  };

  const content = text ?? "";

  if (inline) {
    return (
      <span
        ref={(node) => {
          rootRef.current = node;
        }}
        className={mergedClassName}
        style={mergedStyle}
      >
        {content}
      </span>
    );
  }

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
      }}
      className={mergedClassName}
      style={mergedStyle}
    >
      {content}
    </div>
  );
}
