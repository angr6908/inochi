"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadEmojis, Emoji } from "@/lib/api";
import { Smile } from "lucide-react";

interface EmojiPickerButtonProps {
  onSelect: (emoji: string) => void;
}

interface EmojiSelection {
  id?: string;
  native?: string;
}

export function EmojiPickerButton({ onSelect }: EmojiPickerButtonProps) {
  const [customEmojis, setCustomEmojis] = useState<Emoji[]>([]);
  const [open, setOpen] = useState(false);
  const [PickerComponent, setPickerComponent] = useState<React.ComponentType<Record<string, unknown>> | null>(null);

  useEffect(() => {
    // Custom emojis are an enhancement; if the fetch fails the picker still
    // opens with the standard set rather than rejecting unhandled.
    loadEmojis()
      .then(setCustomEmojis)
      .catch(() => setCustomEmojis([]));
  }, []);

  useEffect(() => {
    if (open && !PickerComponent) {
      Promise.all([
        import("@emoji-mart/react"),
        import("@emoji-mart/data"),
      ])
        .then(([pickerMod, dataMod]) => {
          const Picker = pickerMod.default;
          const data = dataMod.default;
          const Wrapped = (props: Record<string, unknown>) => <Picker data={data} {...props} />;
          setPickerComponent(() => Wrapped);
        })
        // A failed chunk load (offline, stale deploy) would otherwise leave the
        // popover permanently empty with only an unhandled rejection to show.
        .catch(() => setOpen(false));
    }
  }, [open, PickerComponent]);

  const custom = customEmojis.length > 0
    ? [
        {
          id: "custom",
          name: "Custom",
          emojis: customEmojis.map((e) => ({
            id: e.shortcode,
            name: e.shortcode,
            keywords: ["custom"],
            skins: [{ src: e.url }],
          })),
        },
      ]
    : undefined;

  const handleSelect = (emoji: EmojiSelection) => {
    if (emoji.native) {
      onSelect(emoji.native);
    } else if (emoji.id) {
      onSelect(`:${emoji.id}:`);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            tone="muted"
            type="button"
            aria-label="Add emoji"
          />
        }
      >
        <Smile className="size-4" />
      </PopoverTrigger>
      <PopoverContent variant="bare" className="w-auto" align="start">
        {PickerComponent && (
          <PickerComponent
            onEmojiSelect={handleSelect}
            custom={custom}
            // The picker is a self-contained widget that paints its own surface,
            // so it can't inherit the page's scheme from CSS. "auto" makes it
            // resolve the same signal our stylesheet does — it reads
            // prefers-color-scheme and subscribes to changes — which keeps it in
            // step with the OS-driven dark mode without a theme provider.
            theme="auto"
            previewPosition="none"
            skinTonePosition="none"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
