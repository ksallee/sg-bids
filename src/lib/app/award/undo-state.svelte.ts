/**
 * What the last undo left in Flow PT on purpose, in words, for the page that ran it: a Shot or Asset
 * a publish created that has since gained Tasks, Versions or other links. The award panel goes once
 * the undo is done, so the line lives here and `undo-note.svelte` shows it. Cleared by the next run.
 */

export const undoNote = $state<{ requestId: string | null; line: string | null }>({ requestId: null, line: null });

export function setUndoNote(requestId: string, line: string | null): void {
	undoNote.requestId = requestId;
	undoNote.line = line;
}
