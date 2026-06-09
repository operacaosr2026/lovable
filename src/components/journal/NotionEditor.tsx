import { useEffect, useMemo } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { filterSuggestionItems, type PartialBlock } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./notion-editor.css";

function parseInitialContent(raw: string | null | undefined): PartialBlock[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Try JSON (BlockNote document)
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as PartialBlock[];
    } catch {
      // fall through to plain text
    }
  }
  // Legacy plain text → convert each line into its own paragraph block
  return raw.split("\n").map((line) => ({
    type: "paragraph",
    content: line.length ? [{ type: "text", text: line, styles: {} }] : [],
  })) as PartialBlock[];
}

export function NotionEditor({
  initialContent,
  onChange,
  dark = true,
}: {
  initialContent: string | null | undefined;
  onChange: (json: string) => void;
  dark?: boolean;
}) {
  const initial = useMemo(() => parseInitialContent(initialContent), [initialContent]);

  const dictionary = useMemo(() => {
    // Renomeia o slot de cor "gray" para "Preto" — o CSS força essa cor para #000
    const cloned: any = JSON.parse(JSON.stringify(pt));
    if (cloned?.color_picker?.colors?.gray !== undefined) {
      cloned.color_picker.colors.gray = "Preto";
    }
    return cloned;
  }, []);

  const editor = useCreateBlockNote({
    initialContent: initial,
    dictionary,
  });

  useEffect(() => {
    // Skip onChange notifications during the initial mount
    let mounted = false;
    const unsub = editor.onChange(() => {
      if (!mounted) {
        mounted = true;
        return;
      }
      onChange(JSON.stringify(editor.document));
    });
    // mark mounted after a microtask so the very first synthetic change is ignored
    queueMicrotask(() => { mounted = true; });
    return () => { unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="notion-editor-wrapper">
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)
          }
        />
      </BlockNoteView>
    </div>
  );
}
