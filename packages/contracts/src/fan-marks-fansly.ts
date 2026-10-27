// The open fan's warning marks in Fansly's chat header (hub `clientFanMarks`): the header's own client, like
// «Регистрация»'s; no DOM or network. Warnings only: nothing here disables or blocks anything.

/** Where the fan is in a list of one label: on this page (`here`), and the other models' names, deduplicated. */
export interface FanMarksListGroup {
  readonly label: string;
  readonly here: boolean;
  readonly names: readonly string[];
}

/** One post of FANSLY BLOCKLIST, as the explanation shows it. */
export interface FanMarksPostView {
  readonly postedAt: number;
  readonly text: string;
  readonly author: string | null;
  /** A `https://t.me/` link (it opens only for a member of the group); null — none. */
  readonly link: string | null;
  /** The username the post names; `renamed` — not the fan's username now. */
  readonly handle: string;
  readonly renamed: boolean;
}

export interface FanMarksView {
  /** The list mark: the label the header shows (the asked page's, else the first) and every list the fan is in; null — none. */
  readonly lists: { readonly label: string; readonly groups: readonly FanMarksListGroup[] } | null;
  /** FANSLY BLOCKLIST's posts about the fan, newest first; empty — none. */
  readonly posts: readonly FanMarksPostView[];
}

export interface FanMarksClient {
  view(): FanMarksView;
  subscribe(listener: (view: FanMarksView) => void): () => void;
}

/** The words of the marks, by the tab's language (core domain/hosts/fansly/i18n/fan-marks.ts). */
export interface FanMarksCopy {
  /** The blocklist mark in the header. */
  readonly blocklist: string;
  /** «В списке «{label}» у {who}». */
  listsWhere(label: string, here: boolean, names: readonly string[]): string;
  /** The explanation's title over the posts. */
  readonly postsTitle: string;
  /** What FANSLY BLOCKLIST is, in one line. */
  readonly postsAbout: string;
  readonly open: string;
  /** Under the posts: who the link opens for. */
  readonly openNote: string;
  /** «о @old» for a post about another username of the fan. */
  aboutHandle(handle: string): string;
  /** A post's day: «12 окт.», with the year when it is not this one. */
  date(at: number, now: number): string;
}
