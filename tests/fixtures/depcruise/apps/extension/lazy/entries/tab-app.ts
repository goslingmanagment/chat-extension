// A lazy entry of ChatSpace's build: it may carry ChatSpace's half of the adapter — and reaches Fansly's files, by an
// import of its own (a Fansly lazy entry) and through the shared tab composition.
import { APP } from '../../src/composition/tab/app.ts';
import { NOTES } from '../fansly/notes.ts';
export const TAB_APP = [APP, NOTES];
