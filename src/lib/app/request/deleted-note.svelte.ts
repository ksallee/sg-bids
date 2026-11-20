/**
 * The line the requests list shows after a delete, set by the page that deleted: the request page
 * and the builder go back to the list once their request is gone. Dismissed, or replaced by the next.
 */

export const deletedNote = $state<{ line: string | null }>({ line: null });
