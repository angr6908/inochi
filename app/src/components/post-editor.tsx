"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmojiPickerButton } from "./emoji-picker-button";
import { ImageEditGrid } from "./image-edit-grid";
import { createPost } from "@/lib/api";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";

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
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        <ImageEditGrid images={images} onReorder={moveImage} onRemove={removeImage} />
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
