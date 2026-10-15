// The schemas of Fansly's MAIN ↔ isolated bridge (docs/project-unite/
// architecture.md §6): the registry the shared bridge client of the page
// checks every frame from Fansly's MAIN against. The first chunk of Fansly's
// own lazy build (lazy/fansly/): the isolated content script is one classic
// file and cannot split itself, so every Fansly page loads this one with MAIN's
// first frame, right after document_start; the early bundle carries none of it
// (§3.1).

export * from '@cg/host-fansly/isolated/validation';
