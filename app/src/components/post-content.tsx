"use client";

import Link from "next/link";
import { Emoji, loadEmojis, cachedEmojis } from "@/lib/api";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";

const TOKEN = /(https?:\/\/[^\s<>()\[\]{}"']+)|(#[\p{L}\p{N}_]+)|:([a-zA-Z0-9_]+):/gu;

export const PostContent = memo(function PostContent({ content, priority }: { content: string; priority?: boolean }) {
  const [emojis, setEmojis] = useState<Emoji[]>(() => cachedEmojis() ?? []);
  const [loaded, setLoaded] = useState<boolean>(() => cachedEmojis() != null);

  useEffect(() => {
    if (loaded) return;
    let active = true;
    loadEmojis().then((e) => {
      if (!active) return;
      setEmojis(e);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [loaded]);

  // The shortcode→url lookup only depends on the emoji set, so it survives
  // content changes (re-renders while editing) without being rebuilt.
  const emojiUrl = useMemo(
    () => new Map(emojis.map((e) => [e.shortcode, e.url])),
    [emojis],
  );

  const rendered = useMemo(() => {
    let key = 0;

    const renderLine = (text: string, out: ReactNode[]) => {
      let last = 0;
      let m: RegExpExecArray | null;
      TOKEN.lastIndex = 0;
      while ((m = TOKEN.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        if (m[1]) {
          const href = m[1].replace(/[.,!?;:'"]+$/, "");
          const trail = m[1].slice(href.length);
          out.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-primary underline"
            >
              {href}
            </a>,
          );
          if (trail) out.push(trail);
        } else if (m[2]) {
          const tag = m[2].slice(1);
          out.push(
            <Link
              key={key++}
              href={`/?tag=${tag}`}
              className="mx-px rounded-sm bg-primary/10 box-decoration-clone px-1.5 py-0.5 text-[0.9em] font-medium text-primary no-underline [vertical-align:0.0375em] transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {tag}
            </Link>,
          );
        } else {
          const url = emojiUrl.get(m[3]);
          if (url) {
            // eslint-disable-next-line @next/next/no-img-element
            out.push(<img key={key++} src={url} alt={m[3]} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="sync" className="inline-block h-5 w-5 align-text-bottom" />);
          } else if (!loaded) {
            out.push(<span key={key++} aria-hidden className="inline-block h-5 w-5 align-text-bottom" />);
          } else {
            out.push(m[0]);
          }
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(text.slice(last));
    };

    return content
      .split(/\n{2,}/)
      .filter((para) => para !== "")
      .map((para, pi) => {
        const nodes: ReactNode[] = [];
        para.split("\n").forEach((line, li) => {
          if (li > 0) nodes.push(<br key={key++} />);
          renderLine(line, nodes);
        });
        return (
          <p key={pi} className="mb-2 whitespace-pre-wrap break-words last:mb-0 leading-relaxed">
            {nodes}
          </p>
        );
      });
  }, [content, emojiUrl, priority, loaded]);

  return <>{rendered}</>;
});
