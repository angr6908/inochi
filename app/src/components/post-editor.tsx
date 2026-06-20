"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmojiPickerButton } from "./emoji-picker-button";
import { createPost } from "@/lib/api";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";

interface PostEditorProps {
  parentPostId?: string;
  placeholder?: string;
  onPostCreated?: () => void;
}

interface ImageItem {
  id: string;
  file: File;
  preview: string;
}

export function PostEditor({ parentPostId, placeholder, onPostCreated }: PostEditorProps) {
  const [content, setContent] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    selected.forEach((f) => {
      const id = crypto.randomUUID();
      setImages((prev) => [...prev, { id, file: f, preview: "" }]);
      const reader = new FileReader();
      reader.onload = () =>
        setImages((prev) =>
          prev.map((img) => (img.id === id ? { ...img, preview: reader.result as string } : img)),
        );
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const moveImage = (from: number, to: number) => {
    if (from === to) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const nearestIndex = (x: number, y: number) => {
    let best = 0;
    let bestDist = Infinity;
    tileRefs.current.forEach((el, idx) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(index);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragIndex === null) return;
    const target = nearestIndex(e.clientX, e.clientY);
    if (target !== dragIndex) {
      moveImage(dragIndex, target);
      setDragIndex(target);
    }
  };

  const endDrag = () => setDragIndex(null);

  const autoGrow = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    autoGrow();
  };

  const handleEmojiSelect = (emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent = content.slice(0, start) + emoji + content.slice(end);
      setContent(newContent);
    } else {
      setContent((prev) => prev + emoji);
    }
    requestAnimationFrame(autoGrow);
  };

  const handleSubmit = async () => {
    if (!content.trim() && images.length === 0) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("content", content);
      if (parentPostId) fd.append("parent_post_id", parentPostId);
      images.forEach((img) => fd.append("images", img.file));
      await createPost(fd);
      setContent("");
      setImages([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      toast.success("Post created");
      onPostCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create post");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <Textarea
          ref={textareaRef}
          placeholder={placeholder || "Stay connected."}
          value={content}
          onChange={handleChange}
          rows={2}
          className="min-h-[60px] resize-none rounded-none border-0 bg-transparent px-0.5 py-0 font-content text-base leading-relaxed shadow-none placeholder:font-sans focus-visible:ring-0 md:text-base"
        />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div
                key={img.id}
                ref={(el) => {
                  tileRefs.current[i] = el;
                }}
                onPointerDown={(e) => handlePointerDown(e, i)}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={`group relative touch-none select-none transition-transform ${
                  dragIndex === i ? "scale-105 cursor-grabbing opacity-60 shadow-lg" : "cursor-grab"
                }`}
              >
                {img.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.preview}
                    alt=""
                    draggable={false}
                    className="h-20 w-20 rounded-lg object-cover ring-1 ring-border"
                  />
                ) : (
                  <div className="h-20 w-20 animate-pulse rounded-lg bg-muted ring-1 ring-border" />
                )}
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label="Remove image"
                  className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:bg-black/75 focus-visible:outline-none"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFiles}
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Add image"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            <EmojiPickerButton onSelect={handleEmojiSelect} />
          </div>
          <Button size="sm" onClick={handleSubmit} disabled={loading || (!content.trim() && images.length === 0)}>
            {loading ? "Posting..." : parentPostId ? "Echo" : "Post"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
