"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmojiPickerButton } from "./emoji-picker-button";
import { createPost } from "@/lib/api";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";

interface PostEditorProps {
  parentPostId?: string;
  placeholder?: string;
  onPostCreated?: () => void;
}

export function PostEditor({ parentPostId, placeholder, onPostCreated }: PostEditorProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
    selected.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setPreviews((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(f);
    });
  };

  const removeImage = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
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
    if (!content.trim()) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("content", content);
      if (parentPostId) fd.append("parent_post_id", parentPostId);
      files.forEach((f) => fd.append("images", f));
      await createPost(fd);
      setContent("");
      setFiles([]);
      setPreviews([]);
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
          className="min-h-[60px] resize-none rounded-none border-0 bg-transparent px-0.5 py-0 text-base shadow-none focus-visible:ring-0 md:text-base"
        />
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-border" />
                <button
                  onClick={() => removeImage(i)}
                  aria-label="Remove image"
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs shadow-sm transition-transform hover:scale-110"
                >
                  ✕
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
          <Button size="sm" onClick={handleSubmit} disabled={loading || !content.trim()}>
            {loading ? "Posting..." : parentPostId ? "Echo" : "Post"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
