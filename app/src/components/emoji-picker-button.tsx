"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadEmojis, Emoji } from "@/lib/api";
import { Smile } from "lucide-react";

interface EmojiPickerButtonProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPickerButton({ onSelect }: EmojiPickerButtonProps) {
  const [customEmojis, setCustomEmojis] = useState<Emoji[]>([]);
  const [open, setOpen] = useState(false);
  const [PickerComponent, setPickerComponent] = useState<React.ComponentType<Record<string, unknown>> | null>(null);

  useEffect(() => {
    loadEmojis().then(setCustomEmojis);
  }, []);

  useEffect(() => {
    if (open && !PickerComponent) {
      Promise.all([
        import("@emoji-mart/react"),
        import("@emoji-mart/data"),
      ]).then(([pickerMod, dataMod]) => {
        const Picker = pickerMod.default;
        const data = dataMod.default;
        const Wrapped = (props: Record<string, unknown>) => <Picker data={data} {...props} />;
        setPickerComponent(() => Wrapped);
      });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSelect = (emoji: any) => {
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
            type="button"
            aria-label="Add emoji"
            className="size-8 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Smile className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 border-0" align="start">
        {PickerComponent && (
          <PickerComponent
            onEmojiSelect={handleSelect}
            custom={custom}
            theme="light"
            previewPosition="none"
            skinTonePosition="none"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
