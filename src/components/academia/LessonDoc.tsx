import { useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { filterSuggestionItems, type PartialBlock } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./academia.css";
import { TRAINING_SCHEME, trainingFileUrl, uploadTrainingFile } from "./files";

function useIsDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

// Documento da aula: texto, títulos, listas, tabelas, imagens, vídeos e
// arquivos (pelo "/"). Quem só assiste vê a mesma página travada.
export function LessonDoc({ blocks, editable, onChange }: {
  blocks: unknown;
  editable: boolean;
  onChange: (blocks: unknown) => void;
}) {
  const dark = useIsDark();
  const initialContent = useMemo(
    () => (Array.isArray(blocks) && blocks.length ? (blocks as PartialBlock[]) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useCreateBlockNote({
    initialContent,
    dictionary: pt,
    uploadFile: async (file) => `${TRAINING_SCHEME}${await uploadTrainingFile(file)}`,
    resolveFileUrl: async (url) =>
      url.startsWith(TRAINING_SCHEME) ? trainingFileUrl(url.slice(TRAINING_SCHEME.length)) : url,
  });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!editable) return;
    return editor.onChange(() => onChangeRef.current(editor.document));
  }, [editor, editable]);

  return (
    <div className="academia-doc">
      <BlockNoteView editor={editor} editable={editable} theme={dark ? "dark" : "light"} slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)}
        />
      </BlockNoteView>
      {editable && !initialContent && (
        <p className="text-xs text-muted-foreground mt-2">
          Digite <kbd className="px-1 rounded border border-border">/</kbd> para inserir títulos, listas, tabelas, imagens, vídeos ou arquivos.
        </p>
      )}
    </div>
  );
}
